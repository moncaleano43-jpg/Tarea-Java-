package com.cavas.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Límite superior/inferior de un parámetro de proceso por marca (hoja ESPECIFICACIONES MARCA). */
@Entity
@Table(name = "especificacion_marca", uniqueConstraints = @UniqueConstraint(columnNames = {"marca", "parametro"}))
@Getter @Setter @NoArgsConstructor
public class EspecificacionMarca {
    @Id @GeneratedValue(strategy = GenerationType.SEQUENCE) private Long id;
    private String marca;
    private String parametro;
    private Double limiteSup;
    private Double limiteInf;
}
