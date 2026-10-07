package com.cavas.service;

/**
 * Cálculos cerveceros portados 1:1 de las macros VBA del Excel original (Módulo1: Kge, Extracto, VolEqui).
 */
public final class Calculos {
    private Calculos() {}

    private static double factorDensidad(double extracto) {
        return (((extracto - 0.4644) / 238.4) + 1) * extracto - 0.02;
    }

    /** Kilogramos de extracto contenidos en {@code volHl} hectolitros de mosto a {@code eo} °P. */
    public static double kge(double eo, double volHl) {
        return factorDensidad(eo) * volHl;
    }

    /** Extracto (°P) a partir de la densidad. */
    public static double extracto(double densidad) {
        return (-237.9365 + Math.sqrt(Math.pow(237.9365, 2) + 4 * (densidad + 0.02) * 238.4)) / 2;
    }

    /** Volumen (hl) equivalente a {@code kge} kg de extracto a {@code eoEqui} °P. */
    public static double volEqui(double kge, double eoEqui) {
        return kge / factorDensidad(eoEqui);
    }

    /** Atenuación aparente en porcentaje: (EO - E.App) / EO * 100. */
    public static double atenuacion(double eo, double extractoActual) {
        return (eo - extractoActual) / eo * 100.0;
    }

    /** Grado real de fermentación (RDF) en porcentaje: (EO - ER) / EO * 100. */
    public static double rdf(double eo, double extractoReal) {
        return (eo - extractoReal) / eo * 100.0;
    }

    /** Merma volumétrica porcentual (hoja MERMA): (entrada - salida) / entrada * 100. */
    public static double mermaVolumen(double volEntrada, double volSalida) {
        return (volEntrada - volSalida) / volEntrada * 100.0;
    }
}
