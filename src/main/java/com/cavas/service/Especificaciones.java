package com.cavas.service;

import com.cavas.domain.EspecificacionMarca;
import com.cavas.repo.Repos.EspecificacionRepo;
import java.util.Optional;
import org.springframework.stereotype.Service;

/** Acceso a los límites por marca. */
@Service
public class Especificaciones {
    public static final String EO_MOSTO = "E.O Mosto (°P)";
    public static final String TIEMPO_MAX_FV = "Tiempo Max en FV (h)";
    public static final String E_LIM = "E.Lim (°P)";

    private final EspecificacionRepo repo;

    public Especificaciones(EspecificacionRepo repo) {
        this.repo = repo;
    }

    public Optional<EspecificacionMarca> de(String marca, String parametro) {
        if (marca == null) return Optional.empty();
        return repo.findByMarcaIgnoreCase(marca).stream()
                .filter(e -> e.getParametro().equalsIgnoreCase(parametro))
                .findFirst();
    }
}
