package com.cavas.web;

import com.cavas.service.Errores.*;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(NoEncontrado.class)
    ResponseEntity<Map<String, String>> noEncontrado(NoEncontrado e) {
        return error(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(Conflicto.class)
    ResponseEntity<Map<String, String>> conflicto(Conflicto e) {
        return error(HttpStatus.CONFLICT, e.getMessage());
    }

    @ExceptionHandler(Invalido.class)
    ResponseEntity<Map<String, String>> invalido(Invalido e) {
        return error(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> validacion(MethodArgumentNotValidException e) {
        var campos = e.getBindingResult().getFieldErrors().stream().map(f -> f.getField()).distinct().toList();
        return error(HttpStatus.BAD_REQUEST, "Datos incompletos o inválidos: " + String.join(", ", campos));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> ilegible(HttpMessageNotReadableException e) {
        return error(HttpStatus.BAD_REQUEST, "El cuerpo de la petición no es un JSON válido.");
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus s, String msg) {
        return ResponseEntity.status(s).body(Map.of("error", msg));
    }
}
