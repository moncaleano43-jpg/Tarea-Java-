package com.cavas.service;

import com.cavas.domain.*;
import com.cavas.repo.Repos.*;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Estado actual de la cava (equivalente a las hojas INFORME CAVA e INVENTARIO). */
@Service
@Transactional(readOnly = true)
public class InformeService {
    private static final double VIABILIDAD_MINIMA = 0.95; // B.D LEVADURA, fila LCL, col. Viabilidad
    private static final double TEMP_SIEMBRA_MIN = 3.0;   // REGISTRO FV: CI [3-4 °C]
    private static final double TEMP_SIEMBRA_MAX = 4.0;
    private static final double HORAS_ANALISIS_FINAL = 12; // macro "Fisicoquimicos": pendiente tras 12 h en SV

    public enum Nivel { INFO, AVISO, CRITICA }

    public record Alerta(Nivel nivel, String mensaje) {}

    public record TanqueFv(String cons, int tq, String marca, String etapa, Double volumenHl, Double horasEnFv,
                           Double eoPonderado, Double extractoActual, Double atenuacion, Double phActual,
                           LocalDateTime ultimoMuestreo, Double tempM, Double tempI, Double presion,
                           String levadura, Integer generacion, List<Alerta> alertas) {}

    public record TanqueSv(String cons, int tq, String marca, String etapa, Double volumenHl, Double horasEnSv,
                           String fvOrigen, LocalDateTime fechaMuestreoFinal, Double rdf, Double ph,
                           List<Alerta> alertas) {}

    public record Resumen(LocalDateTime actualizado, List<TanqueFv> fermentadores, List<TanqueSv> maduradores,
                          int alertasCriticas, int alertasAviso) {}

    private final FermentacionRepo fermentaciones;
    private final MaduracionRepo maduraciones;
    private final MuestraRepo muestras;
    private final TemperaturaRepo temperaturas;
    private final Especificaciones specs;

    public InformeService(FermentacionRepo f, MaduracionRepo m, MuestraRepo mu, TemperaturaRepo t, Especificaciones s) {
        this.fermentaciones = f;
        this.maduraciones = m;
        this.muestras = mu;
        this.temperaturas = t;
        this.specs = s;
    }

    public Resumen resumen(LocalDateTime ahora) {
        var fvs = fermentaciones.findByEtapaNotIgnoreCaseOrderByTqAsc("VACIO").stream()
                .map(f -> fv(f, ahora)).toList();
        var svs = maduraciones.findByEtapaNotIgnoreCaseOrderByTqAsc("VACIO").stream()
                .map(m -> sv(m, ahora)).toList();
        var todas = new ArrayList<Alerta>();
        fvs.forEach(t -> todas.addAll(t.alertas()));
        svs.forEach(t -> todas.addAll(t.alertas()));
        return new Resumen(ahora, fvs, svs,
                (int) todas.stream().filter(a -> a.nivel() == Nivel.CRITICA).count(),
                (int) todas.stream().filter(a -> a.nivel() == Nivel.AVISO).count());
    }

    private TanqueFv fv(Fermentacion f, LocalDateTime ahora) {
        var t0 = f.getFinLlenado() != null ? f.getFinLlenado() : f.getInicioLlenado();
        Double horas = t0 == null ? null : Duration.between(t0, ahora).toMinutes() / 60.0;
        var ult = muestras.findFirstByFermentacionConsOrderByFechaDesc(f.getCons()).orElse(null);
        var temp = temperaturas.findFirstByFermentacionConsOrderByFechaDesc(f.getCons()).orElse(null);
        Double atenuacion = ult != null && ult.getExtracto() != null && f.getEoPonderado() != null && f.getEoPonderado() > 0
                ? Calculos.atenuacion(f.getEoPonderado(), ult.getExtracto()) : null;

        var alertas = new ArrayList<Alerta>();
        specs.de(f.getMarca(), Especificaciones.TIEMPO_MAX_FV).map(EspecificacionMarca::getLimiteSup).ifPresent(max -> {
            if (horas != null && horas > max) {
                alertas.add(new Alerta(Nivel.CRITICA, "Excede el tiempo máximo en FV (%.0f h > %.0f h)".formatted(horas, max)));
            }
        });
        specs.de(f.getMarca(), Especificaciones.EO_MOSTO).ifPresent(e -> {
            var eo = f.getEoPonderado();
            if (eo != null && e.getLimiteSup() != null && e.getLimiteInf() != null
                    && (eo > e.getLimiteSup() || eo < e.getLimiteInf())) {
                alertas.add(new Alerta(Nivel.AVISO, "E.O fuera de especificación (%.2f °P; rango %.2f–%.2f)"
                        .formatted(eo, e.getLimiteInf(), e.getLimiteSup())));
            }
        });
        Double eLim = f.getELimite();
        if (eLim != null && ult != null && ult.getExtracto() != null && ult.getExtracto() <= eLim
                && "EN".equalsIgnoreCase(f.getEtapa())) {
            alertas.add(new Alerta(Nivel.INFO, "Extracto %.2f °P alcanzó el límite (%.2f °P): evaluar paso a descanso".formatted(ult.getExtracto(), eLim)));
        }
        if (f.getViabilidad() != null && f.getViabilidad() < VIABILIDAD_MINIMA) {
            alertas.add(new Alerta(Nivel.AVISO, "Viabilidad de levadura sembrada baja (%.1f %%)".formatted(f.getViabilidad() * 100)));
        }
        if (f.getTempSiembra() != null && (f.getTempSiembra() < TEMP_SIEMBRA_MIN || f.getTempSiembra() > TEMP_SIEMBRA_MAX)) {
            alertas.add(new Alerta(Nivel.AVISO, "Temperatura de siembra fuera de [3–4 °C]: %.1f °C".formatted(f.getTempSiembra())));
        }
        return new TanqueFv(f.getCons(), f.getTq(), f.getMarca(), f.getEtapa(), f.getVolumenHl(), horas,
                f.getEoPonderado(), ult == null ? null : ult.getExtracto(), atenuacion,
                ult == null ? null : ult.getPh(), ult == null ? null : ult.getFecha(),
                temp == null ? null : temp.getTempM(), temp == null ? null : temp.getTempI(),
                temp == null ? null : temp.getPresion(), f.getLevadura(), f.getGeneracion(), alertas);
    }

    private TanqueSv sv(Maduracion m, LocalDateTime ahora) {
        var t0 = m.getFinTrasiego() != null ? m.getFinTrasiego() : m.getInicioTrasiego();
        Double horas = t0 == null ? null : Duration.between(t0, ahora).toMinutes() / 60.0;
        var alertas = new ArrayList<Alerta>();
        if (horas != null && m.getFechaMuestreoFinal() == null && horas >= HORAS_ANALISIS_FINAL) {
            alertas.add(new Alerta(Nivel.AVISO, "Análisis fisicoquímico final pendiente (%.0f h en SV)".formatted(horas)));
        }
        String origen = m.getFv2Cons() == null || m.getFv2Cons().isBlank() ? m.getFvCons() : m.getFvCons() + " + " + m.getFv2Cons();
        return new TanqueSv(m.getCons(), m.getTq(), m.getMarca(), m.getEtapa(), m.getVolTotalHl(), horas,
                origen, m.getFechaMuestreoFinal(), m.getRdf(), m.getPh(), alertas);
    }
}
