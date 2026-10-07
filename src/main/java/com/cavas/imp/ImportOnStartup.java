package com.cavas.imp;

import com.cavas.repo.Repos.FermentacionRepo;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Si {@code cavas.import-dir} apunta a un directorio y la base está vacía, importa los CSV del Excel. */
@Component
public class ImportOnStartup implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ImportOnStartup.class);

    private final CsvImportService importador;
    private final FermentacionRepo fermentaciones;
    private final String dir;

    public ImportOnStartup(CsvImportService importador, FermentacionRepo fermentaciones,
                           @Value("${cavas.import-dir:}") String dir) {
        this.importador = importador;
        this.fermentaciones = fermentaciones;
        this.dir = dir;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (dir == null || dir.isBlank()) return;
        var p = Path.of(dir);
        if (!Files.isDirectory(p)) {
            log.warn("cavas.import-dir {} no existe; se omite la importación", p);
            return;
        }
        if (fermentaciones.count() > 0) {
            log.info("La base ya tiene datos; se omite la importación de {}", p);
            return;
        }
        log.info("Importando datos del Excel desde {}", p);
        importador.importar(p).forEach((k, v) -> log.info("  {}: {} registros", k, v));
    }
}
