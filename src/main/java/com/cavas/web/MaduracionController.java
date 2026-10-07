package com.cavas.web;

import com.cavas.domain.Maduracion;
import com.cavas.repo.Repos.MaduracionRepo;
import com.cavas.service.Errores.NoEncontrado;
import com.cavas.service.RegistroService;
import com.cavas.service.RegistroService.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/maduraciones")
public class MaduracionController {
    private final MaduracionRepo repo;
    private final RegistroService registro;

    public MaduracionController(MaduracionRepo repo, RegistroService registro) {
        this.repo = repo;
        this.registro = registro;
    }

    @GetMapping
    public List<Maduracion> listar(@RequestParam(defaultValue = "200") int limite) {
        return repo.findAllByOrderByInicioTrasiegoDesc().stream().limit(Math.max(1, Math.min(limite, 1000))).toList();
    }

    @GetMapping("/{cons}")
    public Maduracion detalle(@PathVariable String cons) {
        return repo.findById(cons).orElseThrow(() -> new NoEncontrado("Maduración " + cons + " no existe."));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Maduracion trasiego(@Valid @RequestBody TrasiegoSv in) {
        return registro.registrarTrasiego(in);
    }

    @PutMapping("/{cons}/analisis")
    public Maduracion analisis(@PathVariable String cons, @Valid @RequestBody AnalisisFinal in) {
        return registro.registrarAnalisis(cons, in);
    }

    @PutMapping("/{cons}/etapa")
    public Maduracion etapa(@PathVariable String cons, @RequestBody Map<String, String> body) {
        return registro.cambiarEtapaSv(cons, body.getOrDefault("etapa", ""));
    }
}
