#include <stdio.h>  
#include <stdlib.h>  
#include <string.h>  
#include <unistd.h>  
#include <sys/stat.h>  
#include <signal.h>   
#include <errno.h>  
#include <fcntl.h>  
#include <limits.h>  
  
#define MAX_LENGTH 200  
// 定义全局变量
char thermal_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/thermal_zone0/temp";      // -T
char fan_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/cooling_device0/cur_state";   // -F

int start_speed = 35;   // -s
int start_temp = 45;    // -t
int max_speed = 255;    // -m
int temp_div = 1000;    // -d
int debug_mode = 0;     // -D
int max_temp = 85;      // -M
int hysteresis_temp = 5;// -H
  
/**  
 * 底层读文件  
 */  
static int read_file(const char* path ,char* result ,size_t size) {  
    FILE* fp;  
  
    if (result == NULL || size == 0)  
        return -1;  
  
    fp = fopen(path ,"r");  
    if (fp == NULL)  
        return -1;  
  
    result[0] = '\0';  
    /* fgets 以 size 为硬上限，不会越界写入调用方缓冲区，且结果必定以 NUL 结尾 */  
    if (fgets(result ,(int)size ,fp) != NULL) {  
        /* sysfs 的值带换行，去掉行尾的 CR/LF */  
        result[strcspn(result ,"\r\n")] = '\0';  
    }  
  
    fclose(fp);  
    return 0;  
}  
  
/**  
 * 底层写文件  
 *  
 * 契约：目标限定 sysfs 属性文件——单次 write 即完成，不存在部分写或延迟写语义。  
 * 成功返回写入的字节数（>0）；失败返回 -1，且 errno 被置为 write() 的错误。  
 */  
static int write_file(const char* path ,const char* buf ,size_t len) {  
    int fd;  
    ssize_t written;  
    int saved_errno;  

    fd = open(path ,O_WRONLY);  
    if (fd < 0)  
        return -1;  

    /* 刻意不用 stdio：fopen/fwrite 会先把内容写进用户态缓冲，真实的写错误要到  
       fclose 的 flush 阶段才暴露；一旦忽略 fclose 的返回值，写失败就会被当成成功，  
       于是 last_set_speed 被更新、后续永不重试，风扇卡死在错误档位 */  
    /* sysfs 单次写即完成；信号（例如 SIGTERM）可能打断 write()，EINTR 应重试而不是当成失败 */  
    do {  
        written = write(fd ,buf ,len);  
    } while (written < 0 && errno == EINTR);  
    saved_errno = errno;  
    close(fd);  
    if (written != (ssize_t)len && saved_errno == 0)  
        saved_errno = EIO; // 短写且内核没置 errno：不能让它冒充成功  
    errno = saved_errno;  

    return written == (ssize_t)len ? (int)written : -1;  
}  
  
/**  
 * 把缓冲区内容解析成整数  
 *  
 * 用 strtol 而不是 atoi：atoi 溢出属于 UB，超长数字串会解析出垃圾值（甚至负数）。  
 * 非数字或超出 long 范围时返回 fallback；超出 int 范围则夹到边界。  
 *  
 * 注意：尾部残留字符会被静默忽略（取最长合法前缀），"12abc" 会解析成 12。当前调用方  
 * 都是 sysfs 读数（行尾已在 read_file 里去掉了），因此走不到这种情况。  
 */  
static int parse_int(const char* buf ,int fallback) {  
    char* end = NULL;  
    long value;  
    int saved_errno = errno;  

    errno = 0;  
    value = strtol(buf ,&end ,10);  
    if (end == buf || errno == ERANGE)  
        value = fallback;  
    else if (value > INT_MAX)  
        value = INT_MAX;  
    else if (value < INT_MIN)  
        value = INT_MIN;  
  
    /* 对 errno 保持透明：主循环靠 errno 诊断写失败，不能被这里的 strtol 抹掉 */  
    errno = saved_errno;  
    return (int)value;  
}  
  
/**  
 * 读取温度  
 */  
int get_temperature(char* thermal_file ,int div) {  
    char buf[32] = { 0 };  
    static int warned_bad_div = 0;  
    if (div <= 0) {  
        // temp_div 来自 UCI，配成 0 会让下面的除法抛 SIGFPE；退化成按原始值处理，且只告警一次
        if (!warned_bad_div) {  
            fprintf(stderr ,"Invalid temp_div %d, fallback to 1\n" ,div);  
            warned_bad_div = 1;  
        }  
        div = 1;  
    }  
    if (read_file(thermal_file ,buf ,sizeof(buf)) == 0) {  
        int raw = parse_int(buf ,-1);  
        if (raw < 0)  
            return -1;  
        return raw / div;  
    }  
    return -1;  
}  
  
/**  
 * 读取风扇速度  
 *  
 * 读不到或读到垃圾值时返回 0（当作「风扇停着」），这是刻意的：主循环用  
 * `target_speed != last_set_speed` 作为「仅在变化时写入」的判据，改成返回 -1  
 * 会让 `0 != -1` 成立，于是在「档位未知、温度又落在回滞区间」时主动把正在转的  
 * 风扇写成 0；返回 0 恰好抑制这次写入、什么都不做，是更安全的一侧。  
 */  
int get_fanspeed(char* fan_file) {  
    char buf[32] = { 0 };  
    if (read_file(fan_file ,buf ,sizeof(buf)) == 0) {  
        int level = parse_int(buf ,0);  
        return level > 0 ? level : 0;  
    }  
    return 0; // 读取失败默认当0处理
}  
  
/**  
 * 设置风扇转速  
 */  
int set_fanspeed(int fan_speed ,char* fan_file) {  
    char buf[32] = { 0 };  
    snprintf(buf ,sizeof(buf) ,"%d\n" ,fan_speed);  
    return write_file(fan_file ,buf ,strlen(buf));  
}  
  
/**  
 * 计算风扇转速 (纯计算逻辑)
 */  
int calculate_speed(int current_temp ,int max_temp ,int min_temp ,int max_speed ,int min_speed) {  
    if (current_temp < min_temp) return min_speed; // 防止低温时算出负数

    // 配置非法时直接给满速：max_temp == min_temp 会让下面的除法抛 SIGFPE 打崩守护进程
    if (max_temp <= min_temp) return max_speed;

    int fan_speed = ( current_temp - min_temp ) * ( max_speed - min_speed ) / ( max_temp - min_temp ) + min_speed;  
    if (fan_speed > max_speed) {  
        fan_speed = max_speed;  
    }  
    return fan_speed;  
}  
  
/**  
 * 判断文件是否存在方法  
 */  
static int file_exist(const char* name) {  
    struct stat buffer;  
    return stat(name ,&buffer);  
}  
  
/**  
 *  信号处理函数  
 */  
void handle_termination(int signum) {  
    (void)signum; // 参数未使用：显式标注，避免 -Wextra 警告  
    // 设置风扇转速为 0  
    set_fanspeed(0 ,fan_file);  
    exit(EXIT_SUCCESS); // 优雅地退出程序  
}  
  
/**  
 * 注册信号处理函数  
 */  
void register_signal_handlers( ) {  
    struct sigaction sa;  
    memset(&sa ,0 ,sizeof(sa));  
    sa.sa_handler = handle_termination;  
    sigemptyset(&sa.sa_mask);  
    sigaction(SIGINT ,&sa ,NULL);  
    sigaction(SIGTERM ,&sa ,NULL);  
}  
  
/**  
 * 主函数  
 */  
int main(int argc ,char* argv[ ]) {  
    // 解析命令行选项  
    int opt;  
    /* procd 把 stdout 接到 syslog 时它不是 tty，默认全缓冲会让 -D 的逐轮日志积压数分钟才刷出；  
       stdout 在这个程序里只用作日志流，行缓冲才符合预期 */  
    setvbuf(stdout ,NULL ,_IOLBF ,0);  
    while (( opt = getopt(argc ,argv ,"T:F:s:t:m:d:D:M:H:") ) != -1) {
        switch (opt) {  
            case 'T':  
                snprintf(thermal_file ,sizeof(thermal_file) ,"%s" ,optarg);  
                break;  
            case 'F':  
                snprintf(fan_file ,sizeof(fan_file) ,"%s" ,optarg);  
                break;  
            case 's':  
                start_speed = atoi(optarg);  
                break;  
            case 't':  
                start_temp = atoi(optarg);  
                break;  
            case 'm':  
                max_speed = atoi(optarg);  
                break;  
            case 'd':  
                temp_div = atoi(optarg);  
                break;  
            case 'D':  
                debug_mode = atoi(optarg);
                break;
            case 'M':
                max_temp = atoi(optarg);
                break;
            case 'H':
                hysteresis_temp = atoi(optarg);
                break;
            default:
                exit(EXIT_FAILURE);
        }
    }
    // 检测虚拟文件是否存在  
    if (file_exist(fan_file) != 0 || file_exist(thermal_file) != 0) {  
        fprintf(stderr ,"File: '%s' or '%s' not exist\n" ,fan_file ,thermal_file);  
        exit(EXIT_FAILURE);  
    }  
  
    // 注册退出信号  
    register_signal_handlers( );  
  
    // 监控风扇
    int last_set_speed = get_fanspeed(fan_file); // 程序启动时，先获取一次风扇的当前状态
    while (1) {
        int temperature = get_temperature(thermal_file ,temp_div);
        int target_speed = 0;

        // 只有读到有效温度才处理
        if (temperature > 0) {

            if (last_set_speed > 0) {
                // 如果风扇已经在转了 (Running) ---
                // 只有温度低于 (启动温度 - 回差) 时才关停
                if (temperature < (start_temp - hysteresis_temp)) {
                    target_speed = 0;
                } else {
                    // 否则继续转！
                    // 如果温度低于启动温度，就用最低档转速 (start_speed) 维持
                    if (temperature < start_temp) {
                        target_speed = start_speed;
                    } else {
                        // 超过启动温度，正常按曲线加速
                        target_speed = calculate_speed(temperature ,max_temp ,start_temp ,max_speed ,start_speed);
                    }
                }
            } else {
                // --- 如果风扇是停着的 (Stopped) ---
                // 只有温度达到或超过 启动温度 才开始转
                if (temperature >= start_temp) {
                    target_speed = calculate_speed(temperature ,max_temp ,start_temp ,max_speed ,start_speed);
                } else {
                    target_speed = 0;
                }
            }
            
            // 仅当目标速度与上次设置的速度不同时才写入文件
            if (target_speed != last_set_speed) {
                // 写失败时绝不能更新 last_set_speed：否则目标值与记录值一致，后续循环永不重试
                if (set_fanspeed(target_speed ,fan_file) > 0) {
                    last_set_speed = target_speed;
                } else {
                    fprintf(stderr ,"Failed to write %s (target speed %d): %s\n" ,
                        fan_file ,target_speed ,strerror(errno));
                }
            }
        }
        
        if (debug_mode) {
            fprintf(stdout ,"Temp: %d°C, Status: %s, TargetSpeed: %d\n",
                temperature, (last_set_speed > 0 ? "RUN" : "STOP"), target_speed);
        }
        sleep(5);
    }
    return 0;  
}
