#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <signal.h>

#define MAX_LENGTH 200
#define MAX_POINTS 20    
#define HYSTERESIS 3     

typedef struct {
    int temp;
    int pwm;
} CurvePoint;

char thermal_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/thermal_zone0/temp";
char fan_file[MAX_LENGTH] = "/sys/devices/virtual/thermal/cooling_device0/cur_state";
int temp_div = 1000;
int debug_mode = 0;

CurvePoint curve[MAX_POINTS];
int curve_count = 0;

static int read_file(const char* path, char* result, size_t size) {
    FILE* fp = fopen(path, "r");
    if (!fp) return -1;
    if (fgets(result, size, fp)) {
        result[strcspn(result, "\n")] = 0;
    }
    fclose(fp);
    return 0;
}

static void write_file(const char* path, int value) {
    FILE* fp = fopen(path, "w");
    if (!fp) return;
    fprintf(fp, "%d", value);
    fclose(fp);
}

int get_temperature() {
    char buf[32] = { 0 };
    if (read_file(thermal_file, buf, sizeof(buf)) == 0) {
        return atoi(buf) / temp_div;
    }
    return -1;
}

int get_fan_speed() {
    char buf[32] = { 0 };
    if (read_file(fan_file, buf, sizeof(buf)) == 0) {
        return atoi(buf);
    }
    return 0;
}

int calculate_speed_from_curve(int current_temp) {
    if (curve_count == 0) return 0; 

    if (current_temp <= curve[0].temp) return curve[0].pwm;
    if (current_temp >= curve[curve_count - 1].temp) return curve[curve_count - 1].pwm;

    for (int i = 0; i < curve_count - 1; i++) {
        if (current_temp >= curve[i].temp && current_temp < curve[i+1].temp) {
            int t1 = curve[i].temp;
            int p1 = curve[i].pwm;
            int t2 = curve[i+1].temp;
            int p2 = curve[i+1].pwm;
            int target = p1 + (current_temp - t1) * (p2 - p1) / (t2 - t1);
            return target;
        }
    }
    return 0; 
}

void parse_curve(char* str) {
    char* pair = strtok(str, ",");
    while (pair != NULL && curve_count < MAX_POINTS) {
        int t, p;
        if (sscanf(pair, "%d:%d", &t, &p) == 2) {
            curve[curve_count].temp = t;
            curve[curve_count].pwm = p;
            curve_count++;
        }
        pair = strtok(NULL, ",");
    }
    
    // Bubble sort
    for (int i = 0; i < curve_count - 1; i++) {
        for (int j = 0; j < curve_count - 1 - i; j++) {
            if (curve[j].temp > curve[j+1].temp) {
                CurvePoint temp = curve[j];
                curve[j] = curve[j+1];
                curve[j+1] = temp;
            }
        }
    }
}

void handle_signal(int sig) {
    if (debug_mode) printf("Exiting...\n");
    write_file(fan_file, 0); 
    exit(0);
}

int main(int argc, char* argv[]) {
    // 防止 printf 被缓存，强制立即输出
    setbuf(stdout, NULL);
    setbuf(stderr, NULL);

    int opt;
    // ★★★ 修复点：D后面的冒号去掉了，现在 -D 不需要参数了 ★★★
    while ((opt = getopt(argc, argv, "T:F:d:Dc:")) != -1) {
        switch (opt) {
            case 'T': strncpy(thermal_file, optarg, MAX_LENGTH); break;
            case 'F': strncpy(fan_file, optarg, MAX_LENGTH); break;
            case 'd': temp_div = atoi(optarg); break;
            case 'D': debug_mode = 1; break; // 开启调试
            case 'c': parse_curve(optarg); break;
        }
    }

    if (debug_mode) {
        printf("Fancontrol started.\n");
        printf("Monitoring: %s\n", thermal_file);
        printf("Controlling: %s\n", fan_file);
        printf("Curve points: %d\n", curve_count);
    }

    if (curve_count < 2) {
        fprintf(stderr, "Error: Too few curve points! Use -c '35:0,45:36...'\n");
        exit(1);
    }

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    while (1) {
        int temp = get_temperature();
        int current_pwm = get_fan_speed();
        
        if (temp > 0) {
            int target_pwm = calculate_speed_from_curve(temp);

            // 回差逻辑
            if (current_pwm > 0 && target_pwm == 0) {
                int lowest_active_pwm = 36;
                int first_active_temp = 100;
                for(int i=0; i<curve_count; i++) {
                    if(curve[i].pwm > 0) {
                        lowest_active_pwm = curve[i].pwm;
                        first_active_temp = curve[i].temp;
                        break;
                    }
                }
                if (temp >= (first_active_temp - HYSTERESIS)) {
                    target_pwm = lowest_active_pwm;
                }
            }
            
            if (abs(target_pwm - current_pwm) > 2 || (target_pwm == 0 && current_pwm != 0) || (target_pwm != 0 && current_pwm == 0)) {
                write_file(fan_file, target_pwm);
            }

            if (debug_mode) {
                printf("Temp: %d C, Target: %d, Current: %d\n", temp, target_pwm, current_pwm);
            }
        }
        sleep(3);
    }
    return 0;
}