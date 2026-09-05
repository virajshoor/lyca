#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <float.h>
#include <setjmp.h>

typedef struct { const char *data; int64_t length; } FerraString;
typedef struct FerraAllocation { struct FerraAllocation *next; char data[]; } FerraAllocation;
typedef struct { jmp_buf jump; FerraAllocation *allocations; } FerraContext;

static void ferra_destroy(FerraContext *ctx) {
    while (ctx->allocations) {
        FerraAllocation *next = ctx->allocations->next;
        free(ctx->allocations);
        ctx->allocations = next;
    }
    free(ctx);
}

static void *ferra_allocate(FerraContext *ctx, size_t size) {
    if (size > SIZE_MAX - sizeof(FerraAllocation)) { PyErr_NoMemory(); return NULL; }
    FerraAllocation *p = malloc(sizeof(FerraAllocation) + size);
    if (!p) { PyErr_NoMemory(); return NULL; }
    p->next = ctx->allocations;
    ctx->allocations = p;
    // ponytail: strings live until the outer call ends; add per-value ownership for long-running string workloads.
    return p->data;
}

_Noreturn void ferra_fail(void *context, int32_t code, int32_t line) {
    PyErr_Format(code == 1 ? PyExc_IndexError : PyExc_ArithmeticError,
                 "Ferra runtime error at line %d: %s", line,
                 code == 1 ? "array index out of bounds" : "invalid integer division or remainder");
    longjmp(((FerraContext *)context)->jump, 1);
}

int32_t ferra_print(const FerraString *s) {
    if (fwrite(s->data, 1, (size_t)s->length, stdout) != (size_t)s->length) return -1;
    return fputc('\n', stdout) == EOF ? -1 : 0;
}

static size_t ferra_size(int kind) {
    switch (kind) {
        case 1: return sizeof(int32_t);
        case 2: return sizeof(int64_t);
        case 3: return sizeof(float);
        case 4: return sizeof(double);
        case 5: return sizeof(uint8_t);
        default: return sizeof(FerraString);
    }
}

// count == -1 is a scalar; nonnegative count is a fixed array copied at the boundary.
static int ferra_from_python(FerraContext *ctx, PyObject *value, void *out, int kind, Py_ssize_t count) {
    if (count >= 0) {
        PyObject *seq = PySequence_Fast(value, "expected a numeric sequence");
        if (!seq) return -1;
        if (PySequence_Fast_GET_SIZE(seq) != count) {
            PyErr_Format(PyExc_ValueError, "expected exactly %zd array elements", count);
            Py_DECREF(seq);
            return -1;
        }
        for (Py_ssize_t i = 0; i < count; i++) {
            if (ferra_from_python(ctx, PySequence_Fast_GET_ITEM(seq, i), (char *)out + (size_t)i * ferra_size(kind), kind, -1) < 0) {
                Py_DECREF(seq);
                return -1;
            }
        }
        Py_DECREF(seq);
        return 0;
    }
    if (kind == 1 || kind == 2) {
        if (PyBool_Check(value)) { PyErr_SetString(PyExc_TypeError, "expected integer, not bool"); return -1; }
        PyObject *index = PyNumber_Index(value);
        if (!index) return -1;
        long long n = PyLong_AsLongLong(index);
        Py_DECREF(index);
        if (PyErr_Occurred()) return -1;
        if (kind == 1) {
            if (n < INT32_MIN || n > INT32_MAX) { PyErr_SetString(PyExc_OverflowError, "integer does not fit in i32"); return -1; }
            *(int32_t *)out = (int32_t)n;
        } else *(int64_t *)out = (int64_t)n;
    } else if (kind == 3 || kind == 4) {
        if (PyBool_Check(value)) { PyErr_SetString(PyExc_TypeError, "expected number, not bool"); return -1; }
        double n = PyFloat_AsDouble(value);
        if (PyErr_Occurred()) return -1;
        if (kind == 3) {
            if (isfinite(n) && fabs(n) > FLT_MAX) { PyErr_SetString(PyExc_OverflowError, "number does not fit in f32"); return -1; }
            *(float *)out = (float)n;
        } else *(double *)out = n;
    } else if (kind == 5) {
        if (!PyBool_Check(value)) { PyErr_SetString(PyExc_TypeError, "expected bool"); return -1; }
        *(uint8_t *)out = value == Py_True;
    } else {
        Py_ssize_t length;
        const char *utf8 = PyUnicode_AsUTF8AndSize(value, &length);
        if (!utf8) return -1;
        char *copy = ferra_allocate(ctx, (size_t)length + 1);
        if (!copy) return -1;
        memcpy(copy, utf8, (size_t)length);
        copy[length] = 0;
        *(FerraString *)out = (FerraString){copy, length};
    }
    return 0;
}

static PyObject *ferra_to_python(const void *value, int kind, Py_ssize_t count) {
    if (count >= 0) {
        PyObject *list = PyList_New(count);
        if (!list) return NULL;
        for (Py_ssize_t i = 0; i < count; i++) {
            PyObject *item = ferra_to_python((const char *)value + (size_t)i * ferra_size(kind), kind, -1);
            if (!item) { Py_DECREF(list); return NULL; }
            PyList_SET_ITEM(list, i, item);
        }
        return list;
    }
    switch (kind) {
        case 1: return PyLong_FromLong(*(const int32_t *)value);
        case 2: return PyLong_FromLongLong(*(const int64_t *)value);
        case 3: return PyFloat_FromDouble(*(const float *)value);
        case 4: return PyFloat_FromDouble(*(const double *)value);
        case 5: return PyBool_FromLong(*(const uint8_t *)value != 0);
        default: {
            const FerraString *s = value;
            return PyUnicode_DecodeUTF8(s->data, (Py_ssize_t)s->length, "strict");
        }
    }
}
