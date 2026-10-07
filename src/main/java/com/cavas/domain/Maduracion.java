package com.cavas.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Llenado y maduración en un SV/UTQ con su fisicoquímico final (hoja B.D MADURACIÓN). */
@Entity
@Table(name = "maduracion", indexes = {@Index(columnList = "tq"), @Index(columnList = "etapa")})
@Getter @Setter @NoArgsConstructor
public class Maduracion {
    /** Consecutivo, p.ej. M482. */
    @Id private String cons;
    private Integer tq;
    private String marca;
    /** MADURANDO, LISTO o VACIO. */
    private String etapa = "MADURANDO";
    private String fvCons;
    private Integer fvTq;
    private String fv2Cons;
    private Integer fv2Tq;
    private LocalDateTime inicioTrasiego;
    private LocalDateTime finTrasiego;
    private String loteSilica;
    private Double silicaKg;
    private Double volContadorHl;
    private Double volTotalHl;
    private String responsable;
    private Double eoPonderado;
    private LocalDateTime fechaMuestreoFinal;
    private Double extractoOriginal;
    private Double eApp;
    private Double extractoReal;
    private Double alcoholP;
    private Double alcoholV;
    private Double rdf;
    private Double color;
    private Double ph;
    private Double amargo;
    private Double recuento;
    private Double o2Ppb;
    private Double co2;
    private Double turbidez;
    private String sensorial1;
    private String sensorial2;

    public boolean ocupado() {
        return !"VACIO".equalsIgnoreCase(etapa);
    }
}
