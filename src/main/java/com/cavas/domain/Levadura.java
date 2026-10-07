package com.cavas.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Cosecha de levadura y su (primera) resiembra (hoja B.D LEVADURA). */
@Entity
@Getter @Setter @NoArgsConstructor
public class Levadura {
    /** Código, p.ej. EK7F1 (familia + generación + F + tanque origen). */
    @Id private String codigo;
    private String marca;
    private String familia;
    private Integer utqFuente;
    private Integer generacion;
    private LocalDateTime inicioRemocion;
    private LocalDateTime finRemocion;
    private Double volumenHl;
    private Double consistencia;
    private Double conteo;
    private Double viabilidad;
    private Double ph;
    private Double tempCosecha;
    private String sensorial;
    private String responsable;
    private String consFuente;
    private LocalDateTime maxResiembra;
    private Integer tqResiembra;
    private String consResiembra;
    private LocalDateTime fechaResiembra;
    private Double tempSiembra;
}
