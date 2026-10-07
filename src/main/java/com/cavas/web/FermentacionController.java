package com.cavas.web;

import com.cavas.domain.*;
import com.cavas.repo.Repos.*;
import com.cavas.service.Errores.NoEncontrado;
import com.cavas.service.RegistroService;
import com.cavas.service.RegistroService.*;
import jakarta.validation.Valid;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/fermentaciones")
public class FermentacionController {
    private final FermentacionRepo repo;
    private final MuestraRepo muestras;
    private final TemperaturaRepo temperaturas;
    private final RegistroService registro;

    public FermentacionController(FermentacionRepo r, MuestraRepo m, TemperaturaRepo t, RegistroService s) {
        this.repo = r;
        this.muestras = m;
        this.temperaturas = t;
        this.registro = s;
    }

    public record Detalle(Fermentacion fermentacion, List<MuestraFermentacion> muestras,
                          List<TemperaturaFermentacion> temperaturas) {}

    @GetMapping
    public List<Fermentacion> listar(@RequestParam(required = false) String marca,
                                     @RequestParam(defaultValue = "200") int limite) {
        var todas = marca == null || marca.isBlank()
                ? repo.findAllByOrderByInicioLlenadoDesc()
                : repo.findByMarcaIgnoreCaseOrderByInicioLlenadoDesc(marca);
        return todas.stream().limit(Math.max(1, Math.min(limite, 1000))).toList();
    }

    @GetMapping("/{cons}")
    public Detalle detalle(@PathVariable String cons) {
        var f = repo.findById(cons).orElseThrow(() -> new NoEncontrado("Fermentación " + cons + " no existe."));
        return new Detalle(f, muestras.findByFermentacionConsOrderByFechaAsc(cons),
                temperaturas.findByFermentacionConsOrderByFechaAsc(cons));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Fermentacion llenar(@Valid @RequestBody LlenadoFv in) {
        return registro.registrarLlenado(in);
    }

    @PostMapping("/{cons}/muestras")
    @ResponseStatus(HttpStatus.CREATED)
    public MuestraFermentacion muestra(@PathVariable String cons, @Valid @RequestBody NuevaMuestra in) {
        return registro.agregarMuestra(cons, in);
    }

    @PostMapping("/{cons}/temperaturas")
    @ResponseStatus(HttpStatus.CREATED)
    public TemperaturaFermentacion temperatura(@PathVariable String cons, @Valid @RequestBody NuevaTemperatura in) {
        return registro.agregarTemperatura(cons, in);
    }

    @PutMapping("/{cons}/etapa")
    public Fermentacion etapa(@PathVariable String cons, @RequestBody Map<String, String> body) {
        var cuando = body.get("fecha") == null ? null : LocalDateTime.parse(body.get("fecha"));
        return registro.cambiarEtapaFv(cons, body.getOrDefault("etapa", ""), cuando);
    }
}
