"""Genera una Customer Base di prova: matrice 10 file × 15 colonne.

- File: A..J (10), colonne (numero ombrellone): 1..15.
- Tutte le 150 righe hanno nome + cognome.
- Telefono lasciato vuoto.
- Email: matteo.posterli+Stabilimento<fila><numero>@gmail.com
  (la parte <fila><numero> cambia per ogni ombrellone).
- credito_giornaliero: A=1, B=2, ..., J=10 (stesso pattern del dummy esistente).

Output: samples/customer-base-test-10x15.xlsx
"""
import random
from pathlib import Path

from openpyxl import Workbook

NOMI = [
    "Marco", "Luca", "Giulia", "Francesca", "Alessandro", "Chiara",
    "Matteo", "Sara", "Davide", "Elena", "Simone", "Martina",
    "Andrea", "Valentina", "Stefano", "Federica", "Giovanni", "Laura",
    "Riccardo", "Silvia", "Lorenzo", "Beatrice", "Filippo", "Camilla",
    "Tommaso", "Alice", "Niccolò", "Aurora", "Edoardo", "Giorgia",
    "Pietro", "Eleonora", "Gabriele", "Arianna", "Leonardo", "Bianca",
    "Daniele", "Sofia", "Cristian", "Noemi", "Roberto", "Greta",
    "Antonio", "Vittoria", "Emanuele", "Asia", "Salvatore", "Linda",
]
COGNOMI = [
    "Rossi", "Bianchi", "Ferrari", "Russo", "Romano", "Gallo",
    "Costa", "Fontana", "Conti", "Esposito", "Marino", "Greco",
    "Bruno", "Ricci", "Moretti", "Barbieri", "Lombardi", "Colombo",
    "Fabbri", "Rinaldi", "Serra", "Caruso", "Ferrara", "Mancini",
    "Villa", "De Luca", "Galli", "Martinelli", "Pellegrini", "Palumbo",
    "Sanna", "Farina", "Gatti", "Battaglia", "Sorrentino", "Longo",
    "Leone", "Martini", "Vitale", "Coppola", "Riva", "Donati",
]

FILE = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]
OMBRELLONI_PER_FILA = 15
HEADERS = ["fila", "numero", "credito_giornaliero", "nome", "cognome", "telefono", "email"]


def main() -> None:
    rng = random.Random(2026)  # seed fisso → output riproducibile
    wb = Workbook()
    ws = wb.active
    ws.title = "Ombrelloni"
    ws.append(HEADERS)

    for idx_fila, fila in enumerate(FILE):
        credito = idx_fila + 1  # A=1 ... J=10
        for numero in range(1, OMBRELLONI_PER_FILA + 1):
            nome = rng.choice(NOMI)
            cognome = rng.choice(COGNOMI)
            telefono = ""
            email = f"matteo.posterli+Stabilimento{fila}{numero}@gmail.com"
            ws.append([fila, numero, credito, nome, cognome, telefono, email])

    widths = [8, 8, 20, 16, 16, 16, 52]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    out = Path(__file__).parent / "customer-base-test-10x15.xlsx"
    wb.save(out)
    print(f"Scritto {out} ({len(FILE) * OMBRELLONI_PER_FILA} righe)")


if __name__ == "__main__":
    main()
