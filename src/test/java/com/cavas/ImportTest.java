package com.cavas;

import static org.junit.jupiter.api.Assertions.*;

import com.cavas.imp.CsvImportService;
import com.cavas.repo.Repos.*;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class ImportTest {
    @Autowired CsvImportService importador;
    @Autowired FermentacionRepo fermentaciones;
    @Autowired MuestraRepo muestras;
    @Autowired MaduracionRepo maduraciones;

    @Test
    void importaCsvConValoresVaciosYFechas(@TempDir Path dir) throws Exception {
        Files.writeString(dir.resolve("fermentaciones.csv"), """
                cons,tq,marca,levadura,utq_origen,generacion,consistencia,viabilidad,ph_levadura,temp_siembra,inicio_llenado,fin_llenado,volumen_hl,eo_ponderado,e_limite,recuento_3h,fecha_af_real,etapa
                FX1,27,CLUB COLOMBIA,EQ6F13,13,6.0,0.52,0.95,4.99,4,2025-12-20T00:10:00,2025-12-20T10:25:00,3713,13.94,,20000000,,VACIO
                """);
        Files.writeString(dir.resolve("muestras_fermentacion.csv"), """
                cons,fecha,horas,extracto,atenuacion,ph
                FX1,2025-12-21T12:00:00,25.58,10.86,0.12,4.64
                """);
        Files.writeString(dir.resolve("maduraciones.csv"), """
                cons,tq,marca,fv_cons,fv_origen,etapa
                MX1,11,CLUB COLOMBIA,FX1,27,LISTO
                """);
        var n = importador.importar(dir);
        assertEquals(1, n.get("fermentaciones"));
        assertEquals(0, n.get("temperaturas")); // archivo ausente
        var f = fermentaciones.findById("FX1").orElseThrow();
        assertEquals(6, f.getGeneracion());
        assertNull(f.getELimite());
        assertFalse(f.ocupado());
        assertEquals(1, muestras.findByFermentacionConsOrderByFechaAsc("FX1").size());
        assertEquals("LISTO", maduraciones.findById("MX1").orElseThrow().getEtapa());
    }
}
