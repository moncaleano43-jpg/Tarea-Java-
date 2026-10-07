package com.cavas.repo;

import com.cavas.domain.*;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public final class Repos {
    private Repos() {}

    public interface FermentacionRepo extends JpaRepository<Fermentacion, String> {
        List<Fermentacion> findByEtapaNotIgnoreCaseOrderByTqAsc(String etapa);
        Optional<Fermentacion> findFirstByTqAndEtapaNotIgnoreCase(Integer tq, String etapa);
        List<Fermentacion> findByMarcaIgnoreCaseOrderByInicioLlenadoDesc(String marca);
        List<Fermentacion> findAllByOrderByInicioLlenadoDesc();
        @Query("select max(cast(substring(f.cons, 2) as int)) from Fermentacion f")
        Integer maxConsecutivo();
    }

    public interface MaduracionRepo extends JpaRepository<Maduracion, String> {
        List<Maduracion> findByEtapaNotIgnoreCaseOrderByTqAsc(String etapa);
        Optional<Maduracion> findFirstByTqAndEtapaNotIgnoreCase(Integer tq, String etapa);
        List<Maduracion> findAllByOrderByInicioTrasiegoDesc();
        @Query("select max(cast(substring(m.cons, 2) as int)) from Maduracion m")
        Integer maxConsecutivo();
    }

    public interface MuestraRepo extends JpaRepository<MuestraFermentacion, Long> {
        List<MuestraFermentacion> findByFermentacionConsOrderByFechaAsc(String cons);
        Optional<MuestraFermentacion> findFirstByFermentacionConsOrderByFechaDesc(String cons);
    }

    public interface TemperaturaRepo extends JpaRepository<TemperaturaFermentacion, Long> {
        List<TemperaturaFermentacion> findByFermentacionConsOrderByFechaAsc(String cons);
        Optional<TemperaturaFermentacion> findFirstByFermentacionConsOrderByFechaDesc(String cons);
    }

    public interface LevaduraRepo extends JpaRepository<Levadura, String> {
        List<Levadura> findAllByOrderByFinRemocionDesc();
        /** Levadura cosechada y aún sin resembrar. */
        List<Levadura> findByTqResiembraIsNullOrderByMaxResiembraAsc();
    }

    public interface EspecificacionRepo extends JpaRepository<EspecificacionMarca, Long> {
        List<EspecificacionMarca> findByMarcaIgnoreCase(String marca);
    }
}
