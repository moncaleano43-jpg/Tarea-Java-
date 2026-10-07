package com.cavas.service;

import com.cavas.domain.*;
import com.cavas.repo.Repos.*;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Predicate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Cumplimiento de indicadores por marca (equivalente a la hoja CUMPLIMIENTO INDICADORES). */
@Service
@Transactional(readOnly = true)
public class IndicadoresService {
    /** Viabilidad mínima, generación máxima y O2 máximo según los límites de las hojas B.D LEVADURA / B.D MADURACIÓN. */
    static final double VIABILIDAD_MIN = 0.95;
    static final int GENERACION_MAX = 10;
    static final double O2_MADURACION_MAX_PPB = 15;

    public record Indicador(String nombre, String unidad, int medidos, int cumplen, Double porcentaje) {}

    public record PorMarca(String marca, List<Indicador> indicadores) {}

    private final FermentacionRepo fermentaciones;
    private final MaduracionRepo maduraciones;
    private final Especificaciones specs;

    public IndicadoresService(FermentacionRepo f, MaduracionRepo m, Especificaciones s) {
        this.fermentaciones = f;
        this.maduraciones = m;
        this.specs = s;
    }

    public List<PorMarca> cumplimiento(LocalDate desde, LocalDate hasta) {
        var fer = fermentaciones.findAllByOrderByInicioLlenadoDesc().stream()
                .filter(f -> f.getInicioLlenado() != null)
                .filter(f -> !f.getInicioLlenado().toLocalDate().isBefore(desde) && !f.getInicioLlenado().toLocalDate().isAfter(hasta))
                .toList();
        var mad = maduraciones.findAllByOrderByInicioTrasiegoDesc().stream()
                .filter(m -> m.getInicioTrasiego() != null)
                .filter(m -> !m.getInicioTrasiego().toLocalDate().isBefore(desde) && !m.getInicioTrasiego().toLocalDate().isAfter(hasta))
                .toList();
        var marcas = new TreeSet<String>();
        fer.forEach(f -> marcas.add(f.getMarca()));
        mad.forEach(m -> marcas.add(m.getMarca()));

        var out = new ArrayList<PorMarca>();
        for (var marca : marcas) {
            var f = fer.stream().filter(x -> marca.equalsIgnoreCase(x.getMarca())).toList();
            var m = mad.stream().filter(x -> marca.equalsIgnoreCase(x.getMarca())).toList();
            var inds = new ArrayList<Indicador>();
            inds.add(ind("Viabilidad levadura sembrada", "%", f, Fermentacion::getViabilidad, v -> v >= VIABILIDAD_MIN));
            inds.add(ind("Generación de levadura", "gen", f, x -> x.getGeneracion() == null ? null : x.getGeneracion().doubleValue(),
                    v -> v <= GENERACION_MAX));
            inds.add(ind("Temperatura de siembra", "°C", f, Fermentacion::getTempSiembra, v -> v >= 3 && v <= 4));
            inds.add(medirEo(marca, f));
            inds.add(ind("O2 disuelto en maduración", "ppb", m, Maduracion::getO2Ppb, v -> v <= O2_MADURACION_MAX_PPB));
            out.add(new PorMarca(marca, inds));
        }
        return out;
    }

    private Indicador medirEo(String marca, List<Fermentacion> f) {
        var spec = specs.de(marca, Especificaciones.EO_MOSTO).orElse(null);
        if (spec == null || spec.getLimiteSup() == null || spec.getLimiteInf() == null) {
            return new Indicador("E.O mosto en especificación", "°P", 0, 0, null);
        }
        return ind("E.O mosto en especificación", "°P", f, Fermentacion::getEoPonderado,
                v -> v >= spec.getLimiteInf() && v <= spec.getLimiteSup());
    }

    private static <T> Indicador ind(String nombre, String unidad, List<T> datos,
                                     java.util.function.Function<T, Double> valor, Predicate<Double> cumple) {
        int medidos = 0, ok = 0;
        for (var d : datos) {
            Double v = valor.apply(d);
            if (v == null || v == 0) continue; // 0 = sin dato en el Excel
            medidos++;
            if (cumple.test(v)) ok++;
        }
        return new Indicador(nombre, unidad, medidos, ok, medidos == 0 ? null : ok * 100.0 / medidos);
    }
}
