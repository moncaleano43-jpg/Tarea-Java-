package com.cavas;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.cavas.service.Calculos;
import org.junit.jupiter.api.Test;

class CalculosTest {
    @Test
    void kgeYVolumenEquivalenteSonInversos() {
        double kge = Calculos.kge(18.0, 3800);
        assertEquals(3800, Calculos.volEqui(kge, 18.0), 1e-9);
    }

    @Test
    void kgeCoincideConLaFormulaDelExcel() {
        // (((18-0.4644)/238.4)+1)*18-0.02 = 19.3 (aprox) por hl
        double porHl = (((18.0 - 0.4644) / 238.4) + 1) * 18.0 - 0.02;
        assertEquals(porHl * 100, Calculos.kge(18.0, 100), 1e-9);
    }

    @Test
    void extractoDesdeDensidadInvierteElFactor() {
        double factor = (((12.0 - 0.4644) / 238.4) + 1) * 12.0 - 0.02;
        assertEquals(12.0, Calculos.extracto(factor), 0.01);
    }

    @Test
    void atenuacionYRdfCoincidenConDatosReales() {
        // Fila M590 del Excel: E.O 18.17, E.R 6.91 -> RDF 61.96 %
        assertEquals(61.96, Calculos.rdf(18.17, 6.91), 0.02);
        assertEquals(76.5, Calculos.atenuacion(18.0, 4.23), 0.1);
    }

    @Test
    void mermaVolumen() {
        assertEquals(2.0, Calculos.mermaVolumen(4000, 3920), 1e-9);
    }
}
