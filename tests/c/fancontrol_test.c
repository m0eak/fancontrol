/*
 * Host-side regression tests for the fancontrol daemon.
 *
 * The daemon source is included rather than linked so that the static helpers
 * (read_file, write_file, parse_int) can be exercised directly -- they are
 * where the interesting bound and error-handling bugs have been. main() is
 * renamed on the way in so this file can supply its own.
 *
 * Run with tests/run.sh, which builds this with -fsanitize=address,undefined:
 * the buffer-overrun cases below are only meaningful under a sanitiser.
 */
#define main fancontrol_main
#include "../../fancontrol/src/fancontrol.c"
#undef main

#include <assert.h>

static int failed;

static void ok(const char *what, int cond)
{
	printf("%-6s %s\n", cond ? "ok" : "FAIL", what);
	if (!cond)
		failed++;
}

static void eq(const char *what, int got, int want)
{
	printf("%-6s %s  (got %d, want %d)\n", got == want ? "ok" : "FAIL", what, got, want);
	if (got != want)
		failed++;
}

static void write_text(const char *path, const char *text)
{
	FILE *fp = fopen(path, "w");

	assert(fp != NULL);
	fputs(text, fp);
	fclose(fp);
}

static void write_digits(const char *path, size_t count)
{
	FILE *fp = fopen(path, "w");
	size_t i;

	assert(fp != NULL);
	for (i = 0; i < count; i++)
		fputc('1', fp);
	fputc('\n', fp);
	fclose(fp);
}

int main(void)
{
	char dir[128], file[192], sensor[192], fan[192];
	struct stat sb;

	snprintf(dir, sizeof(dir), "/tmp/fancontrol-test-%d", (int)getpid());
	mkdir(dir, 0700);
	snprintf(file, sizeof(file), "%s/value", dir);
	snprintf(sensor, sizeof(sensor), "%s/temp", dir);
	snprintf(fan, sizeof(fan), "%s/fan", dir);

	/*
	 * Reading sensor values.
	 */
	write_text(sensor, "45000\n");
	eq("get_temperature reads a sysfs-shaped value", get_temperature(sensor, 1000), 45);

	write_text(sensor, "45000\r\n");
	eq("get_temperature tolerates CRLF", get_temperature(sensor, 1000), 45);

	write_text(sensor, "");
	eq("get_temperature rejects an empty file", get_temperature(sensor, 1000), -1);

	write_text(sensor, "\n");
	eq("get_temperature rejects a newline only", get_temperature(sensor, 1000), -1);

	write_text(sensor, "45000\n");
	eq("get_temperature falls back when div < 1", get_temperature(sensor, 0), 45000);

	/*
	 * read_file used to copy the length of the file into an 8-byte buffer.
	 * ASan reported "WRITE of size 120" before the fix; these two only need
	 * to not crash and not yield a negative level.
	 */
	write_digits(file, 120);
	eq("get_temperature rejects an overlong value", get_temperature(file, 1000), -1);
	eq("get_fanspeed never reports a negative level", get_fanspeed(file) >= 0, 1);

	/*
	 * Fan level.
	 */
	write_text(fan, "117\n");
	eq("get_fanspeed reads a level", get_fanspeed(fan), 117);

	write_text(fan, "999999999999999999999999999999999999\n");
	eq("get_fanspeed clamps an unparseable level", get_fanspeed(fan) >= 0, 1);

	/*
	 * parse_int. atoi's overflow is undefined; strtol plus fallback replaces it.
	 */
	eq("parse_int reads a value", parse_int("45000", 0), 45000);
	eq("parse_int clamps above INT_MAX", parse_int("3000000000", 0), INT_MAX);
	eq("parse_int clamps below INT_MIN", parse_int("-2147483649", 0), INT_MIN);
	eq("parse_int falls back on text", parse_int("abc", 7), 7);
	eq("parse_int falls back on empty", parse_int("", 7), 7);
	eq("parse_int falls back on blanks", parse_int("   ", 7), 7);
	eq("parse_int falls back on a bare sign", parse_int("-", 7), 7);
	eq("parse_int falls back when out of long range",
	   parse_int("1111111111111111111111111111111", 0), 0);
	eq("parse_int takes the longest valid prefix", parse_int("12abc", 9), 12);

	/*
	 * The main loop reports write failures with strerror(errno), so a helper
	 * that quietly clears errno would break those diagnostics.
	 */
	errno = EIO;
	(void)parse_int("42", 0);
	eq("parse_int leaves the caller's errno alone", errno, EIO);

	/*
	 * Fan curve. max_temp <= start_temp used to divide by zero (SIGFPE).
	 */
	eq("calculate_speed interpolates", calculate_speed(60, 85, 45, 255, 35), 117);
	eq("calculate_speed holds the floor below the start", calculate_speed(40, 85, 45, 255, 35), 35);
	eq("calculate_speed fails safe when max == min", calculate_speed(50, 45, 45, 255, 35), 255);
	/* The main loop only calls this with current_temp >= start_temp, so an
	 * invalid curve is reached with the low-temperature guard already passed. */
	eq("calculate_speed fails safe when max < min", calculate_speed(60, 40, 60, 255, 35), 255);
	/* The guard order is deliberate: below start_temp the low-temperature rule
	 * wins, so even a broken curve returns the floor rather than the maximum. */
	eq("calculate_speed keeps the floor below start on a bad curve",
	   calculate_speed(50, 40, 60, 255, 35), 35);

	/*
	 * set_fanspeed formatted into char[8] with sprintf: a level of eight
	 * digits or more overran it (ASan: "WRITE of size 12").
	 */
	write_text(fan, "0\n");
	ok("set_fanspeed accepts a large level", set_fanspeed(2000000000, fan) > 0);
	{
		char readback[64] = { 0 };
		FILE *fp = fopen(fan, "r");

		assert(fp != NULL);
		if (fgets(readback, sizeof(readback), fp) == NULL)
			readback[0] = '\0';
		fclose(fp);
		ok("set_fanspeed wrote the large level", atoi(readback) > 0);
	}

	/*
	 * write_file must report a failed write instead of recording it as done.
	 */
	eq("write_file writes a regular file", write_file(fan, "9\n", 2), 2);
	eq("write_file reports a directory as a failure", write_file(dir, "9\n", 2), -1);

	if (stat("/dev/full", &sb) == 0)
		eq("write_file reports ENOSPC", write_file("/dev/full", "9\n", 2), -1);
	else
		printf("skip   write_file on a full device -- /dev/full unavailable\n");

	printf("\n%s: %d check(s) failed\n", failed ? "FAIL" : "PASS", failed);
	return failed ? 1 : 0;
}
