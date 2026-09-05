#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct { const char *data; int64_t length; } FerraString;

int32_t ferra_print(const FerraString *s) {
    if (fwrite(s->data, 1, (size_t)s->length, stdout) != (size_t)s->length) return -1;
    return fputc('\n', stdout) == EOF ? -1 : 0;
}

_Noreturn void ferra_fail(void *context, int32_t code, int32_t line) {
    (void)context;
    fprintf(stderr, "Ferra runtime error at line %d: %s\n", line,
            code == 1 ? "array index out of bounds" : "invalid integer division or remainder");
    exit(1);
}
