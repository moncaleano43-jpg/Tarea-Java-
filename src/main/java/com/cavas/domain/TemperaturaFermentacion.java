package com.cavas.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Lectura de temperatura y presión de un FV. */
@Entity
@Table(name = "temperatura_fermentacion", indexes = @Index(columnList = "fermentacionCons"))
@Getter @Setter @NoArgsConstructor
public class TemperaturaFermentacion {
    @Id @GeneratedValue(strategy = GenerationType.SEQUENCE) private Long id;
    private String fermentacionCons;
    private LocalDateTime fecha;
    private Double horas;
    private Double tempM;
    private Double tempI;
    private Double setPoint;
    private Double presion;
}
