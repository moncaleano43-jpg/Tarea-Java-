package com.cavas.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Una corrida de fermentación en un FV (hoja B.D FERMENTACIÓN). */
@Entity
@Table(name = "fermentacion", indexes = {@Index(columnList = "tq"), @Index(columnList = "etapa")})
@Getter @Setter @NoArgsConstructor
public class Fermentacion {
    /** Consecutivo, p.ej. F483. */
    @Id private String cons;
    private Integer tq;
    private String marca;
    /** Etapa: EN (fermentación), AF (descanso/atenuación final), RF (frío), VACIO. */
    private String etapa = "EN";
    private String levadura;
    private Integer utqOrigen;
    private Integer generacion;
    private Double consistencia;
    private Double viabilidad;
    private Double phLevadura;
    private Double tempSiembra;
    private LocalDateTime inicioLlenado;
    private LocalDateTime finLlenado;
    private Double volumenHl;
    private Double eoPonderado;
    private Double eLimite;
    private Double recuento3h;
    private LocalDateTime fechaAfReal;

    public boolean ocupado() {
        return !"VACIO".equalsIgnoreCase(etapa);
    }
}
