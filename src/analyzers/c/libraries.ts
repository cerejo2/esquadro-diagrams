// Library of an external function, used to group the `external` nodes of the
// call graph (stdio, stdlib, pthread, IPC POSIX...). Unknown names go to "other".
const LIBS: Record<string, string> = {};

function add(lib: string, names: string): void {
  for (const n of names.split(/\s+/)) if (n) LIBS[n] = lib;
}

add(
  'stdio',
  `printf fprintf sprintf snprintf vprintf vfprintf vsprintf vsnprintf dprintf puts fputs putchar fputc putc
   getchar fgetc getc ungetc fgets gets scanf fscanf sscanf vscanf vsscanf fopen freopen fclose fflush fread fwrite
   fseek ftell rewind fgetpos fsetpos feof ferror clearerr perror remove rename tmpfile tmpnam setbuf setvbuf
   fileno getline getdelim popen pclose`,
);
add(
  'stdlib',
  `malloc calloc realloc free aligned_alloc exit _Exit abort atexit at_quick_exit quick_exit atoi atol atoll atof
   strtol strtoll strtoul strtoull strtod strtof strtold qsort bsearch rand srand random srandom drand48 srand48
   lrand48 abs labs llabs div ldiv getenv setenv unsetenv putenv system mkstemp realpath`,
);
add(
  'string',
  `strlen strnlen strcpy strncpy strcat strncat strcmp strncmp strcasecmp strncasecmp strchr strrchr strstr strdup
   strndup strtok strtok_r strspn strcspn strpbrk strerror strcoll strxfrm memcpy memmove memset memcmp memchr bzero`,
);
add(
  'ctype',
  `isalpha isdigit isalnum isspace isupper islower ispunct isprint iscntrl isxdigit isgraph isblank toupper tolower`,
);
add(
  'math',
  `sqrt cbrt pow exp exp2 log log2 log10 sin cos tan asin acos atan atan2 sinh cosh tanh fabs floor ceil round
   trunc fmod fmin fmax hypot lround llround rint nearbyint`,
);
add('assert', 'assert');
add(
  'unistd',
  `fork vfork execl execlp execle execv execvp execve getpid getppid getuid geteuid getgid sleep usleep read write
   close pipe dup dup2 getopt unlink access alarm pause chdir getcwd lseek isatty sysconf _exit`,
);
add('sys/wait', 'wait waitpid');
add('signal', 'signal sigaction kill raise sigemptyset sigfillset sigaddset sigdelset sigprocmask sigsuspend');
add('time', 'time clock difftime mktime localtime gmtime strftime ctime asctime nanosleep clock_gettime gettimeofday');
add('libgen', 'basename dirname');
add('fcntl', 'open fcntl creat');
add(
  'IPC POSIX',
  `semget semop semctl semtimedop shmget shmat shmdt shmctl msgget msgsnd msgrcv msgctl ftok sem_open sem_close
   sem_unlink sem_init sem_destroy sem_wait sem_trywait sem_timedwait sem_post sem_getvalue shm_open shm_unlink
   mmap munmap mq_open mq_close mq_send mq_receive mq_unlink`,
);

export function libraryOf(name: string): string {
  const known = LIBS[name];
  if (known) return known;
  if (name.startsWith('pthread_')) return 'pthread';
  if (name.startsWith('sem_') || name.startsWith('shm_') || name.startsWith('mq_')) return 'IPC POSIX';
  return 'other';
}
