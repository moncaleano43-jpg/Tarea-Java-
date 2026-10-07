package com.cavas.imp;

import com.cavas.domain.*;
import com.cavas.repo.Repos.*;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Carga los CSV generados por {@code tools/extract_excel.py} (datos históricos del Excel). */
@Service
public class CsvImportService {
    private final FermentacionRepo fermentaciones;
    private final MuestraRepo muestras;
    private final TemperaturaRepo temperaturas;
    private final MaduracionRepo maduraciones;
    private final LevaduraRepo levaduras;
    private final EspecificacionRepo especificaciones;

    public CsvImportService(FermentacionRepo f, MuestraRepo mu, TemperaturaRepo t, MaduracionRepo ma,
                            LevaduraRepo l, EspecificacionRepo e) {
        this.fermentaciones = f;
        this.muestras = mu;
        this.temperaturas = t;
        this.maduraciones = ma;
        this.levaduras = l;
        this.especificaciones = e;
    }

    @Transactional
    public Map<String, Integer> importar(Path dir) throws IOException {
        var out = new LinkedHashMap<String, Integer>();
        out.put("especificaciones", cargar(dir, "especificaciones.csv", r -> {
            var e = new EspecificacionMarca();
            e.setMarca(s(r, "marca").toUpperCase());
            e.setParametro(s(r, "parametro"));
            e.setLimiteSup(d(r, "limite_sup"));
            e.setLimiteInf(d(r, "limite_inf"));
            return e;
        }, especificaciones::saveAll));
        out.put("levaduras", cargar(dir, "levaduras.csv", r -> {
            var l = new Levadura();
            l.setCodigo(s(r, "codigo"));
            l.setMarca(s(r, "marca"));
            l.setFamilia(s(r, "familia"));
            l.setUtqFuente(i(r, "utq_fuente"));
            l.setGeneracion(i(r, "generacion"));
            l.setInicioRemocion(t(r, "inicio_remocion"));
            l.setFinRemocion(t(r, "fin_remocion"));
            l.setVolumenHl(d(r, "volumen_hl"));
            l.setConsistencia(d(r, "consistencia"));
            l.setConteo(d(r, "conteo"));
            l.setViabilidad(d(r, "viabilidad"));
            l.setPh(d(r, "ph"));
            l.setTempCosecha(d(r, "temp_cosecha"));
            l.setSensorial(s(r, "sensorial"));
            l.setResponsable(s(r, "responsable"));
            l.setConsFuente(s(r, "cons_fuente"));
            l.setMaxResiembra(t(r, "max_resiembra"));
            l.setTqResiembra(i(r, "tq_resiembra"));
            l.setConsResiembra(s(r, "cons_resiembra"));
            l.setFechaResiembra(t(r, "fecha_resiembra"));
            l.setTempSiembra(d(r, "temp_siembra"));
            return l;
        }, levaduras::saveAll));
        out.put("fermentaciones", cargar(dir, "fermentaciones.csv", r -> {
            var f = new Fermentacion();
            f.setCons(s(r, "cons"));
            f.setTq(i(r, "tq"));
            f.setMarca(s(r, "marca"));
            f.setEtapa(or(s(r, "etapa"), "EN"));
            f.setLevadura(s(r, "levadura"));
            f.setUtqOrigen(i(r, "utq_origen"));
            f.setGeneracion(i(r, "generacion"));
            f.setConsistencia(d(r, "consistencia"));
            f.setViabilidad(d(r, "viabilidad"));
            f.setPhLevadura(d(r, "ph_levadura"));
            f.setTempSiembra(d(r, "temp_siembra"));
            f.setInicioLlenado(t(r, "inicio_llenado"));
            f.setFinLlenado(t(r, "fin_llenado"));
            f.setVolumenHl(d(r, "volumen_hl"));
            f.setEoPonderado(d(r, "eo_ponderado"));
            f.setELimite(d(r, "e_limite"));
            f.setRecuento3h(d(r, "recuento_3h"));
            f.setFechaAfReal(t(r, "fecha_af_real"));
            return f;
        }, fermentaciones::saveAll));
        out.put("muestras_fermentacion", cargar(dir, "muestras_fermentacion.csv", r -> {
            var m = new MuestraFermentacion();
            m.setFermentacionCons(s(r, "cons"));
            m.setFecha(t(r, "fecha"));
            m.setHoras(d(r, "horas"));
            m.setExtracto(d(r, "extracto"));
            m.setAtenuacion(d(r, "atenuacion"));
            m.setPh(d(r, "ph"));
            return m;
        }, muestras::saveAll));
        out.put("temperaturas", cargar(dir, "temperaturas.csv", r -> {
            var x = new TemperaturaFermentacion();
            x.setFermentacionCons(s(r, "cons"));
            x.setFecha(t(r, "fecha"));
            x.setHoras(d(r, "horas"));
            x.setTempM(d(r, "temp_m"));
            x.setTempI(d(r, "temp_i"));
            x.setSetPoint(d(r, "set_point"));
            x.setPresion(d(r, "presion"));
            return x;
        }, temperaturas::saveAll));
        out.put("maduraciones", cargar(dir, "maduraciones.csv", r -> {
            var m = new Maduracion();
            m.setCons(s(r, "cons"));
            m.setTq(i(r, "tq"));
            m.setMarca(s(r, "marca"));
            m.setEtapa(or(s(r, "etapa"), "MADURANDO"));
            m.setFvCons(s(r, "fv_cons"));
            m.setFvTq(i(r, "fv_origen"));
            m.setFv2Cons(s(r, "fv2_cons"));
            m.setFv2Tq(i(r, "fv2_tq"));
            m.setInicioTrasiego(t(r, "inicio_trasiego"));
            m.setFinTrasiego(t(r, "fin_trasiego"));
            m.setLoteSilica(s(r, "lote_silica"));
            m.setSilicaKg(d(r, "silica_kg"));
            m.setVolContadorHl(d(r, "vol_contador_hl"));
            m.setResponsable(s(r, "responsable"));
            m.setVolTotalHl(d(r, "vol_total_hl"));
            m.setEoPonderado(d(r, "eo_ponderado"));
            m.setFechaMuestreoFinal(t(r, "fecha_muestreo_final"));
            m.setExtractoOriginal(d(r, "extracto_original"));
            m.setEApp(d(r, "e_app"));
            m.setExtractoReal(d(r, "extracto_real"));
            m.setAlcoholP(d(r, "alcohol_p"));
            m.setAlcoholV(d(r, "alcohol_v"));
            m.setRdf(d(r, "rdf"));
            m.setColor(d(r, "color"));
            m.setPh(d(r, "ph"));
            m.setAmargo(d(r, "amargo"));
            m.setRecuento(d(r, "recuento"));
            m.setO2Ppb(d(r, "o2_ppb"));
            m.setCo2(d(r, "co2"));
            m.setTurbidez(d(r, "turbidez"));
            m.setSensorial1(s(r, "sensorial1"));
            m.setSensorial2(s(r, "sensorial2"));
            return m;
        }, maduraciones::saveAll));
        return out;
    }

    private <T> int cargar(Path dir, String archivo, Function<CSVRecord, T> mapa, java.util.function.Consumer<List<T>> guardar)
            throws IOException {
        var p = dir.resolve(archivo);
        if (!Files.exists(p)) return 0;
        var lista = new ArrayList<T>();
        try (Reader in = Files.newBufferedReader(p, StandardCharsets.UTF_8);
             var parser = CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).build().parse(in)) {
            for (var r : parser) lista.add(mapa.apply(r));
        }
        guardar.accept(lista);
        return lista.size();
    }

    private static String s(CSVRecord r, String col) {
        if (!r.isMapped(col)) return null;
        var v = r.get(col).trim();
        return v.isEmpty() ? null : v;
    }

    private static Double d(CSVRecord r, String col) {
        var v = s(r, col);
        if (v == null) return null;
        try {
            return Double.valueOf(v);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer i(CSVRecord r, String col) {
        var v = d(r, col);
        return v == null ? null : (int) Math.round(v);
    }

    private static LocalDateTime t(CSVRecord r, String col) {
        var v = s(r, col);
        if (v == null) return null;
        try {
            return LocalDateTime.parse(v);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String or(String v, String def) { return v == null ? def : v; }
}
