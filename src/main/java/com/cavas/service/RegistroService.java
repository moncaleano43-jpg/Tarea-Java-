package com.cavas.service;

import com.cavas.domain.*;
import com.cavas.repo.Repos.*;
import com.cavas.service.Errores.*;
import java.time.Duration;
import java.time.LocalDateTime;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reglas de negocio de los registros que el Excel hacía con macros (REGISTRO FV / SV / ANÁLISIS). */
@Service
@Transactional
public class RegistroService {
    public static final Set<String> ETAPAS_FV = Set.of("EN", "AF", "RF", "VACIO");
    public static final Set<String> ETAPAS_SV = Set.of("MADURANDO", "LISTO", "VACIO");

    private final FermentacionRepo fermentaciones;
    private final MaduracionRepo maduraciones;
    private final MuestraRepo muestras;
    private final TemperaturaRepo temperaturas;
    private final LevaduraRepo levaduras;

    public RegistroService(FermentacionRepo f, MaduracionRepo m, MuestraRepo mu, TemperaturaRepo t, LevaduraRepo l) {
        this.fermentaciones = f;
        this.maduraciones = m;
        this.muestras = mu;
        this.temperaturas = t;
        this.levaduras = l;
    }

    // ---- Recibo de mosto en FV ----

    public record LlenadoFv(@NotNull Integer tq, @NotBlank String marca, @NotNull LocalDateTime inicioLlenado, LocalDateTime finLlenado,
                            Double volumenHl, Double eoPonderado, Double eLimite, Double recuento3h,
                            String levaduraCodigo, String levaduraPropagador, Double tempSiembra) {}

    public Fermentacion registrarLlenado(LlenadoFv in) {
        fermentaciones.findFirstByTqAndEtapaNotIgnoreCase(in.tq(), "VACIO").ifPresent(f -> {
            throw new Conflicto("El FV " + in.tq() + " ya está en uso (" + f.getCons() + "). Verifique antes de continuar.");
        });
        if (in.finLlenado() != null && in.inicioLlenado() != null && in.finLlenado().isBefore(in.inicioLlenado())) {
            throw new Invalido("El fin de llenado no puede ser anterior al inicio.");
        }
        var f = new Fermentacion();
        f.setCons("F" + (nz(fermentaciones.maxConsecutivo()) + 1));
        f.setTq(in.tq());
        f.setMarca(in.marca().toUpperCase());
        f.setInicioLlenado(in.inicioLlenado());
        f.setFinLlenado(in.finLlenado());
        f.setVolumenHl(in.volumenHl());
        f.setEoPonderado(in.eoPonderado());
        f.setELimite(in.eLimite());
        f.setRecuento3h(in.recuento3h());
        f.setTempSiembra(in.tempSiembra());

        if (in.levaduraCodigo() != null && !in.levaduraCodigo().isBlank()) {
            var lev = levaduras.findById(in.levaduraCodigo())
                    .orElseThrow(() -> new NoEncontrado("Levadura " + in.levaduraCodigo() + " no existe."));
            f.setLevadura(lev.getCodigo());
            f.setUtqOrigen(lev.getUtqFuente());
            f.setGeneracion(lev.getGeneracion());
            f.setConsistencia(lev.getConsistencia());
            f.setViabilidad(lev.getViabilidad());
            f.setPhLevadura(lev.getPh());
            if (lev.getTqResiembra() == null) { // primera resiembra de esa cosecha
                lev.setTqResiembra(in.tq());
                lev.setConsResiembra(f.getCons());
                lev.setFechaResiembra(in.inicioLlenado());
                lev.setTempSiembra(in.tempSiembra());
            }
        } else {
            f.setLevadura(in.levaduraPropagador());
        }
        return fermentaciones.save(f);
    }

    public record NuevaMuestra(@NotNull LocalDateTime fecha, @NotNull Double extracto, Double ph) {}

    public MuestraFermentacion agregarMuestra(String cons, NuevaMuestra in) {
        var f = fermentacion(cons);
        var m = new MuestraFermentacion();
        m.setFermentacionCons(cons);
        m.setFecha(in.fecha());
        m.setExtracto(in.extracto());
        m.setPh(in.ph());
        var t0 = f.getFinLlenado() != null ? f.getFinLlenado() : f.getInicioLlenado();
        if (t0 != null) m.setHoras(horas(t0, in.fecha()));
        if (f.getEoPonderado() != null && f.getEoPonderado() > 0 && in.extracto() != null) {
            m.setAtenuacion(Calculos.atenuacion(f.getEoPonderado(), in.extracto()) / 100.0);
        }
        return muestras.save(m);
    }

    public record NuevaTemperatura(@NotNull LocalDateTime fecha, Double tempM, Double tempI, Double setPoint, Double presion) {}

    public TemperaturaFermentacion agregarTemperatura(String cons, NuevaTemperatura in) {
        var f = fermentacion(cons);
        var t = new TemperaturaFermentacion();
        t.setFermentacionCons(cons);
        t.setFecha(in.fecha());
        t.setTempM(in.tempM());
        t.setTempI(in.tempI());
        t.setSetPoint(in.setPoint());
        t.setPresion(in.presion());
        var t0 = f.getFinLlenado() != null ? f.getFinLlenado() : f.getInicioLlenado();
        if (t0 != null) t.setHoras(horas(t0, in.fecha()));
        return temperaturas.save(t);
    }

    public Fermentacion cambiarEtapaFv(String cons, String etapa, LocalDateTime cuando) {
        var e = etapa.toUpperCase();
        if (!ETAPAS_FV.contains(e)) throw new Invalido("Etapa inválida: " + etapa + " (válidas: " + ETAPAS_FV + ")");
        var f = fermentacion(cons);
        f.setEtapa(e);
        if (e.equals("AF") && f.getFechaAfReal() == null) f.setFechaAfReal(cuando != null ? cuando : LocalDateTime.now());
        return f;
    }

    // ---- Trasiego FV -> SV ----

    public record TrasiegoSv(@NotNull Integer tq, @NotBlank String fvCons, String fv2Cons, @NotNull LocalDateTime inicioTrasiego,
                             LocalDateTime finTrasiego, Double volContadorHl, String loteSilica,
                             Double silicaKg, String responsable) {}

    public Maduracion registrarTrasiego(TrasiegoSv in) {
        maduraciones.findFirstByTqAndEtapaNotIgnoreCase(in.tq(), "VACIO").ifPresent(m -> {
            throw new Conflicto("El SV " + in.tq() + " ya está en uso (" + m.getCons() + ").");
        });
        var fv1 = fermentacion(in.fvCons());
        Fermentacion fv2 = in.fv2Cons() == null || in.fv2Cons().isBlank() ? null : fermentacion(in.fv2Cons());
        for (var fv : new Fermentacion[] {fv1, fv2}) {
            if (fv != null && !fv.ocupado()) throw new Conflicto("El fermentador " + fv.getCons() + " ya fue trasegado.");
        }
        if (fv2 != null && !fv1.getMarca().equalsIgnoreCase(fv2.getMarca())) {
            throw new Conflicto("No se pueden mezclar marcas distintas en un SV: " + fv1.getMarca() + " / " + fv2.getMarca());
        }
        var m = new Maduracion();
        m.setCons("M" + (nz(maduraciones.maxConsecutivo()) + 1));
        m.setTq(in.tq());
        m.setMarca(fv1.getMarca());
        m.setFvCons(fv1.getCons());
        m.setFvTq(fv1.getTq());
        m.setInicioTrasiego(in.inicioTrasiego());
        m.setFinTrasiego(in.finTrasiego());
        m.setVolContadorHl(in.volContadorHl());
        m.setLoteSilica(in.loteSilica());
        m.setSilicaKg(in.silicaKg());
        m.setResponsable(in.responsable());
        double vol1 = nz(fv1.getVolumenHl());
        double vol2 = fv2 == null ? 0 : nz(fv2.getVolumenHl());
        m.setVolTotalHl(in.volContadorHl() != null ? in.volContadorHl() : vol1 + vol2);
        if (fv2 != null) {
            m.setFv2Cons(fv2.getCons());
            m.setFv2Tq(fv2.getTq());
        }
        if (vol1 + vol2 > 0 && fv1.getEoPonderado() != null) {
            double eo2 = fv2 == null || fv2.getEoPonderado() == null ? fv1.getEoPonderado() : fv2.getEoPonderado();
            m.setEoPonderado((fv1.getEoPonderado() * vol1 + eo2 * vol2) / (vol1 + vol2));
        }
        fv1.setEtapa("VACIO");
        if (fv2 != null) fv2.setEtapa("VACIO");
        return maduraciones.save(m);
    }

    public record AnalisisFinal(@NotNull LocalDateTime fechaMuestreo, Double extractoOriginal, Double eApp, Double extractoReal,
                                Double alcoholP, Double alcoholV, Double rdf, Double color, Double ph,
                                Double amargo, Double recuento, Double o2Ppb, Double co2, Double turbidez,
                                String sensorial1, String sensorial2) {}

    public Maduracion registrarAnalisis(String cons, AnalisisFinal in) {
        var m = maduracion(cons);
        m.setFechaMuestreoFinal(in.fechaMuestreo());
        m.setExtractoOriginal(in.extractoOriginal());
        m.setEApp(in.eApp());
        m.setExtractoReal(in.extractoReal());
        m.setAlcoholP(in.alcoholP());
        m.setAlcoholV(in.alcoholV());
        Double rdf = in.rdf();
        if (rdf == null && in.extractoOriginal() != null && in.extractoReal() != null && in.extractoOriginal() > 0) {
            rdf = Calculos.rdf(in.extractoOriginal(), in.extractoReal());
        }
        m.setRdf(rdf);
        m.setColor(in.color());
        m.setPh(in.ph());
        m.setAmargo(in.amargo());
        m.setRecuento(in.recuento());
        m.setO2Ppb(in.o2Ppb());
        m.setCo2(in.co2());
        m.setTurbidez(in.turbidez());
        m.setSensorial1(in.sensorial1());
        m.setSensorial2(in.sensorial2());
        return m;
    }

    public Maduracion cambiarEtapaSv(String cons, String etapa) {
        var e = etapa.toUpperCase();
        if (!ETAPAS_SV.contains(e)) throw new Invalido("Etapa inválida: " + etapa + " (válidas: " + ETAPAS_SV + ")");
        var m = maduracion(cons);
        m.setEtapa(e);
        return m;
    }

    // ---- Levadura ----

    public Levadura cosechar(Levadura in) {
        if (in.getCodigo() == null || in.getCodigo().isBlank()) throw new Invalido("El código de levadura es obligatorio.");
        if (levaduras.existsById(in.getCodigo())) throw new Conflicto("Ya existe la levadura " + in.getCodigo() + ".");
        in.setTqResiembra(null);
        in.setConsResiembra(null);
        in.setFechaResiembra(null);
        return levaduras.save(in);
    }

    // ---- util ----

    private Fermentacion fermentacion(String cons) {
        return fermentaciones.findById(cons).orElseThrow(() -> new NoEncontrado("Fermentación " + cons + " no existe."));
    }

    private Maduracion maduracion(String cons) {
        return maduraciones.findById(cons).orElseThrow(() -> new NoEncontrado("Maduración " + cons + " no existe."));
    }

    static double horas(LocalDateTime desde, LocalDateTime hasta) {
        return Duration.between(desde, hasta).toSeconds() / 3600.0;
    }

    private static int nz(Integer i) { return i == null ? 0 : i; }
    private static double nz(Double d) { return d == null ? 0 : d; }
}
