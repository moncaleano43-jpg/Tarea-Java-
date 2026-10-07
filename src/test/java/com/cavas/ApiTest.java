package com.cavas;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.cavas.repo.Repos.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ApiTest {
    @Autowired MockMvc mvc;
    @Autowired FermentacionRepo fermentaciones;
    @Autowired MaduracionRepo maduraciones;

    @BeforeEach
    void limpiar() {
        maduraciones.deleteAll();
        fermentaciones.deleteAll();
    }

    private static final String LLENADO = """
            {"tq":7,"marca":"LIGHT","inicioLlenado":"2026-10-01T08:00:00","finLlenado":"2026-10-01T16:00:00",
             "volumenHl":3800,"eoPonderado":16.0,"levaduraPropagador":"P1","tempSiembra":3.5}""";

    @Test
    void flujoCompletoPorHttp() throws Exception {
        mvc.perform(post("/api/fermentaciones").contentType(MediaType.APPLICATION_JSON).content(LLENADO))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cons").value("F1"));
        mvc.perform(post("/api/fermentaciones").contentType(MediaType.APPLICATION_JSON).content(LLENADO))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").exists());
        mvc.perform(post("/api/fermentaciones/F1/muestras").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fecha\":\"2026-10-02T16:00:00\",\"extracto\":12.0,\"ph\":4.7}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.horas").value(24.0));
        mvc.perform(get("/api/fermentaciones/F1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.muestras.length()").value(1));
        mvc.perform(get("/api/resumen").param("ahora", "2026-10-03T00:00:00"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fermentadores[0].atenuacion").value(25.0));
        mvc.perform(post("/api/maduraciones").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tq\":3,\"fvCons\":\"F1\",\"inicioTrasiego\":\"2026-10-10T08:00:00\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cons").value("M1"));
        mvc.perform(get("/api/resumen")).andExpect(jsonPath("$.fermentadores.length()").value(0))
                .andExpect(jsonPath("$.maduradores.length()").value(1));
    }

    @Test
    void validacionYNoEncontrado() throws Exception {
        mvc.perform(post("/api/fermentaciones").contentType(MediaType.APPLICATION_JSON).content("{\"marca\":\"X\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/fermentaciones").contentType(MediaType.APPLICATION_JSON).content("no es json"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/fermentaciones/F999")).andExpect(status().isNotFound());
        mvc.perform(put("/api/fermentaciones/F999/etapa").contentType(MediaType.APPLICATION_JSON).content("{\"etapa\":\"EN\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void calculadora() throws Exception {
        mvc.perform(get("/api/calculos").param("eo", "18").param("volHl", "100").param("eoEqui", "18"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.volEquivalenteHl").value(100.0));
    }
}
