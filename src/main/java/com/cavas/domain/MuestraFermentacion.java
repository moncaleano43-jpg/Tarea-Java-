package com.cavas.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Muestreo de extracto y pH durante la fermentación (curva de atenuación). */
@Entity
@Table(name = "muestra_fermentacion", indexes = @Index(columnList = "fermentacionCons"))
@Getter @Setter @NoArgsConstructor
public class MuestraFermentacion {
    @Id @GeneratedValue(strategy = GenerationType.SEQUENCE) private Long id;
    private String fermentacionCons;
    private LocalDateTime fecha;
    /** Horas desde el inicio de fermentación. */
    private Double horas;
    private Double extracto;
    private Double atenuacion;
    private Double ph;
}
