package com.cavas.web;

import com.cavas.domain.EspecificacionMarca;
import com.cavas.domain.Levadura;
import com.cavas.repo.Repos.*;
import com.cavas.service.Calculos;
import com.cavas.service.IndicadoresService;
import com.cavas.service.IndicadoresService.PorMarca;
import com.cavas.service.InformeService;
import com.cavas.service.InformeService.Resumen;
import com.cavas.service.RegistroService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** Dashboard, indicadores, levadura, especificaciones y calculadoras. */
@RestController
@RequestMapping("/api")
public class CavaController {
    private final InformeService informe;
    private final IndicadoresService indicadores;
    private final LevaduraRepo levaduras;
    private final EspecificacionRepo specs;
    private final RegistroService registro;

    public CavaController(InformeService informe, IndicadoresService indicadores, LevaduraRepo levaduras,
                          EspecificacionRepo specs, RegistroService registro) {
        this.informe = informe;
        this.indicadores = indicadores;
        this.levaduras = levaduras;
        this.specs = specs;
        this.registro = registro;
    }

    /** {@code ahora} permite consultar el estado "como estaba" en otro momento (útil con datos históricos). */
    @GetMapping("/resumen")
    public Resumen resumen(@RequestParam(required = false) LocalDateTime ahora) {
        return informe.resumen(ahora != null ? ahora : LocalDateTime.now());
    }

    @GetMapping("/indicadores")
    public List<PorMarca> indicadores(@RequestParam(required = false) LocalDate desde,
                                      @RequestParam(required = false) LocalDate hasta) {
        var h = hasta != null ? hasta : LocalDate.now();
        return indicadores.cumplimiento(desde != null ? desde : h.minusDays(90), h);
    }

    @GetMapping("/levaduras")
    public List<Levadura> levaduras(@RequestParam(defaultValue = "false") boolean disponibles,
                                    @RequestParam(defaultValue = "200") int limite) {
        var l = disponibles ? levaduras.findByTqResiembraIsNullOrderByMaxResiembraAsc()
                : levaduras.findAllByOrderByFinRemocionDesc();
        return l.stream().limit(Math.max(1, Math.min(limite, 1000))).toList();
    }

    @PostMapping("/levaduras")
    @ResponseStatus(HttpStatus.CREATED)
    public Levadura cosechar(@RequestBody Levadura in) {
        return registro.cosechar(in);
    }

    @GetMapping("/especificaciones")
    public List<EspecificacionMarca> especificaciones(@RequestParam(required = false) String marca) {
        return marca == null || marca.isBlank() ? specs.findAll() : specs.findByMarcaIgnoreCase(marca);
    }

    /** Calculadoras de la hoja de macros: kge, volumen equivalente, extracto desde densidad, RDF. */
    @GetMapping("/calculos")
    public Map<String, Double> calculos(@RequestParam(required = false) Double eo,
                                        @RequestParam(required = false) Double volHl,
                                        @RequestParam(required = false) Double eoEqui,
                                        @RequestParam(required = false) Double densidad,
                                        @RequestParam(required = false) Double extractoReal) {
        var out = new java.util.LinkedHashMap<String, Double>();
        if (eo != null && volHl != null) {
            double kge = Calculos.kge(eo, volHl);
            out.put("kge", kge);
            if (eoEqui != null) out.put("volEquivalenteHl", Calculos.volEqui(kge, eoEqui));
        }
        if (densidad != null) out.put("extractoPlato", Calculos.extracto(densidad));
        if (eo != null && extractoReal != null) out.put("rdfPorcentaje", Calculos.rdf(eo, extractoReal));
        return out;
    }
}
