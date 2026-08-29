#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;

static void stop_process(int signal_number) {
  (void)signal_number;
  stopping = 1;
}

int main(int argc, char **argv) {
  const char *log_path = getenv("CODEXCTL_FAKE_DESKTOP_LOG");
  if (log_path == NULL) return 64;
  FILE *log = fopen(log_path, "a");
  if (log == NULL) return 74;
  fprintf(log, "start pid=%d", getpid());
  for (int index = 1; index < argc; index += 1) fprintf(log, " arg=%s", argv[index]);
  fputc('\n', log);
  fflush(log);
  if (getenv("CODEXCTL_FAKE_DESKTOP_CHILD") != NULL) {
    pid_t child = fork();
    if (child < 0) return 71;
    if (child == 0) {
      if (strcmp(getenv("CODEXCTL_FAKE_DESKTOP_CHILD"), "2") == 0) {
        pid_t grandchild = fork();
        if (grandchild < 0) _exit(73);
        if (grandchild == 0) {
          execl("/bin/sleep", "sleep", "300", NULL);
          _exit(72);
        }
        fprintf(log, "grandchild pid=%d\n", grandchild);
        fflush(log);
      }
      execl("/bin/sleep", "sleep", "300", NULL);
      _exit(72);
    }
    fprintf(log, "child pid=%d\n", child);
    fflush(log);
  }
  signal(SIGTERM, stop_process);
  signal(SIGINT, stop_process);
  while (!stopping) pause();
  fprintf(log, "stop pid=%d\n", getpid());
  fclose(log);
  return 0;
}
