package com.cavas.service;

public final class Errores {
    private Errores() {}

    public static class NoEncontrado extends RuntimeException {
        public NoEncontrado(String msg) { super(msg); }
    }

    public static class Conflicto extends RuntimeException {
        public Conflicto(String msg) { super(msg); }
    }

    public static class Invalido extends RuntimeException {
        public Invalido(String msg) { super(msg); }
    }
}
