package com.cavas;

import static org.junit.jupiter.api.Assertions.*;

import com.cavas.domain.*;
import com.cavas.repo.Repos.*;
import com.cavas.service.*;
import com.cavas.service.Errores.*;
import com.cavas.service.RegistroService.*;
import java.time.LocalDateTime;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class FlujoCavaTest {
    @Autowired RegistroService registro;
    @Autowired InformeService informe;
    @Autowired IndicadoresService indicadores;
    @Autowired FermentacionRepo fermentaciones;
    @Autowired MaduracionRepo maduraciones;
    @Autowired MuestraRepo muestras;
    @Autowired TemperaturaRepo temperaturas;
    @Autowired LevaduraRepo levaduras;
    @Autowired EspecificacionRepo specs;

    static final LocalDateTime T0 = LocalDateTime.of(2026, 10, 1, 8, 0);

    @BeforeEach
    void limpiar() {
        muestras.deleteAll();
        temperaturas.deleteAll();
        maduraciones.deleteAll();
        fermentaciones.deleteAll();
        levaduras.deleteAll();
        specs.deleteAll();
        for (var p : new Object[][] {
                {Especificaciones.EO_MOSTO, 18.15, 17.85}, {Especificaciones.TIEMPO_MAX_FV, 240.0, null}}) {
            var e = new EspecificacionMarca();
            e.setMarca("ESTANDAR");
            e.setParametro((String) p[0]);
            e.setLimiteSup((Double) p[1]);
            e.setLimiteInf((Double) p[2]);
            specs.save(e);
        }
    }

    private Fermentacion llenar(int tq) {
        return registro.registrarLlenado(new LlenadoFv(tq, "estandar", T0, T0.plusHours(8), 3800.0, 18.0, 3.8, 20_000_000.0,
                null, "PROP1", 3.5));
    }

    @Test
    void llenadoAsignaConsecutivoYRechazaTanqueOcupado() {
        var f = llenar(14);
        assertEquals("F1", f.getCons());
        assertEquals("ESTANDAR", f.getMarca());
        assertEquals("EN", f.getEtapa());
        var e = assertThrows(Conflicto.class, () -> llenar(14));
        assertTrue(e.getMessage().contains("FV 14"));
        assertEquals("F2", llenar(15).getCons());
    }

    @Test
    void llenadoConLevaduraCosechadaHeredaDatosYMarcaResiembra() {
        var l = new Levadura();
        l.setCodigo("EK7F1");
        l.setGeneracion(7);
        l.setViabilidad(0.96);
        l.setConsistencia(0.5);
        l.setUtqFuente(1);
        registro.cosechar(l);
        var f = registro.registrarLlenado(new LlenadoFv(3, "ESTANDAR", T0, null, 3800.0, 18.0, null, null, "EK7F1", null, 3.0));
        assertEquals(7, f.getGeneracion());
        assertEquals(0.96, f.getViabilidad());
        assertEquals("F1", levaduras.findById("EK7F1").orElseThrow().getConsResiembra());
        assertEquals(0, levaduras.findByTqResiembraIsNullOrderByMaxResiembraAsc().size());
        assertThrows(NoEncontrado.class, () -> registro.registrarLlenado(
                new LlenadoFv(4, "ESTANDAR", T0, null, 3800.0, 18.0, null, null, "NOEXISTE", null, 3.0)));
    }

    @Test
    void muestraCalculaHorasYAtenuacion() {
        var f = llenar(14);
        var m = registro.agregarMuestra(f.getCons(), new NuevaMuestra(T0.plusHours(8 + 24), 13.5, 4.8));
        assertEquals(24.0, m.getHoras(), 1e-6);
        assertEquals(0.25, m.getAtenuacion(), 1e-6); // (18-13.5)/18
    }

    @Test
    void trasiegoVaciaFvCreaSvYBloqueaReuso() {
        var f = llenar(14);
        var m = registro.registrarTrasiego(new TrasiegoSv(9, f.getCons(), null, T0.plusDays(10), T0.plusDays(10).plusHours(9),
                3790.0, "7039", 21.0, "CC"));
        assertEquals("M1", m.getCons());
        assertEquals("ESTANDAR", m.getMarca());
        assertEquals(18.0, m.getEoPonderado(), 1e-9);
        assertFalse(fermentaciones.findById(f.getCons()).orElseThrow().ocupado());
        assertThrows(Conflicto.class, () -> registro.registrarTrasiego(
                new TrasiegoSv(10, f.getCons(), null, T0, T0, 3790.0, null, null, null))); // FV ya trasegado
        var f2 = llenar(14); // el FV vacío puede reutilizarse
        assertThrows(Conflicto.class, () -> registro.registrarTrasiego(
                new TrasiegoSv(9, f2.getCons(), null, T0, T0, 3790.0, null, null, null))); // SV 9 ocupado
    }

    @Test
    void trasiegoNoMezclaMarcas() {
        var a = llenar(14);
        var b = registro.registrarLlenado(new LlenadoFv(15, "LIGHT", T0, null, 3800.0, 16.0, null, null, null, "P", 3.0));
        assertThrows(Conflicto.class, () -> registro.registrarTrasiego(
                new TrasiegoSv(9, a.getCons(), b.getCons(), T0, T0, null, null, null, null)));
    }

    @Test
    void trasiegoDeDosFvPondera() {
        var a = llenar(14);
        var b = registro.registrarLlenado(new LlenadoFv(15, "ESTANDAR", T0, null, 1900.0, 18.3, null, null, null, "P", 3.0));
        var m = registro.registrarTrasiego(new TrasiegoSv(9, a.getCons(), b.getCons(), T0.plusDays(9), T0.plusDays(9), null, null, null, null));
        assertEquals(5700.0, m.getVolTotalHl(), 1e-9);
        assertEquals((18.0 * 3800 + 18.3 * 1900) / 5700, m.getEoPonderado(), 1e-9);
    }

    @Test
    void analisisFinalCalculaRdf() {
        var f = llenar(14);
        var m = registro.registrarTrasiego(new TrasiegoSv(9, f.getCons(), null, T0, T0, null, null, null, null));
        var r = registro.registrarAnalisis(m.getCons(), new AnalisisFinal(T0.plusDays(2), 18.17, 4.2, 6.91, null, null, null,
                11.2, 4.5, 26.3, null, 7.0, 2.2, null, "OK", "OK"));
        assertEquals(61.96, r.getRdf(), 0.02);
    }

    @Test
    void etapaInvalidaSeRechaza() {
        var f = llenar(14);
        assertThrows(Invalido.class, () -> registro.cambiarEtapaFv(f.getCons(), "XX", null));
        var af = registro.cambiarEtapaFv(f.getCons(), "af", T0.plusDays(3));
        assertEquals("AF", af.getEtapa());
        assertEquals(T0.plusDays(3), af.getFechaAfReal());
    }

    @Test
    void resumenAlertaPorTiempoExcedidoYEoFueraDeRango() {
        var f = registro.registrarLlenado(new LlenadoFv(14, "ESTANDAR", T0, T0, 3800.0, 17.0, null, null, null, "P", 3.0));
        var r = informe.resumen(T0.plusHours(250));
        assertEquals(1, r.fermentadores().size());
        var t = r.fermentadores().get(0);
        assertEquals(f.getCons(), t.cons());
        assertEquals(250.0, t.horasEnFv(), 0.01);
        assertEquals(1, r.alertasCriticas());
        assertTrue(t.alertas().stream().anyMatch(a -> a.mensaje().contains("E.O fuera")));
    }

    @Test
    void indicadoresPorMarca() {
        llenar(14);
        var res = indicadores.cumplimiento(T0.toLocalDate().minusDays(1), T0.toLocalDate().plusDays(1));
        assertEquals(1, res.size());
        var eo = res.get(0).indicadores().stream().filter(i -> i.nombre().startsWith("E.O")).findFirst().orElseThrow();
        assertEquals(1, eo.medidos());
        assertEquals(1, eo.cumplen()); // 18.0 °P está dentro de [17.85, 18.15]
    }
}
