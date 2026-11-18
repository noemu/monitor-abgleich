# Monitor-Abgleich

Web-App, um zwei Monitore per Handyfoto aneinander anzugleichen.

Live: https://noemu.github.io/monitor-abgleich/

1. Testbild auf beiden Monitoren im Vollbild anzeigen.
2. Mit dem Handy die Stelle fotografieren, an der die Monitore aneinanderstoßen. Von jedem Monitor reicht der zugewandte Messstreifen mit den beiden ArUco-Codes an seinen Enden. Gemessen wird nur an diesen beiden Streifen, weil die Kamera sie im gleichen Winkel sieht.
3. Die App wählt einen Monitor als Referenz und zeigt, was am anderen einzustellen ist: R/G/B-Gain, Helligkeit, Kontrast, Gamma, Schwarzwert, Sättigung. Regler, die der Monitor nicht hat, lassen sich abwählen. Die App rechnet dann mit den übrigen oder nennt einen Ausweg.

Die Kamera misst nicht absolut. Aussagekräftig ist nur der Vergleich der beiden Monitore im selben Foto. Nach dem Verstellen neu fotografieren.

Läuft komplett im Browser, es werden keine Bilder hochgeladen.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/pattern.js` | Testbild: Messfelder an allen vier Rändern, Verläufe, ArUco-Marker (4×4) in den Ecken |
| `js/detect.js` | Marker im Foto finden (mehrere Auflösungen), den beiden Monitoren zuordnen (ab zwei Markern pro Monitor), Bildecken per Homographie berechnen |
| `js/analyze.js` | Zugewandte Seiten bestimmen, Messfelder dort auslesen, Gamma/Weißpunkt/Schwarzwert/Sättigung vergleichen, Empfehlungen ableiten |
| `js/geometry.js` | Homographie (Least Squares), Hilfsfunktionen |
| `js/synth.js` | Künstliche Fotos für Beispiel und Tests |
| `js/app.js` | Oberfläche |
| `js/vendor/js-aruco2` | [js-aruco2](https://github.com/damianofalcioni/js-aruco2) 2.0.0, MIT |

## Entwicklung

```
npm test     # Erkennung und Auswertung gegen künstliche Fotos
npm start    # lokaler Server auf http://localhost:8080
```

Die Seite nutzt ES-Module und muss über HTTP geöffnet werden, nicht per `file://`.
