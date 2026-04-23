"""Genera un file Excel dummy per importazione massiva in ShareAndFun.

Struttura:
- 5 file (A, B, C, D, E); la prima fila (A) ha credito 1 e ogni fila successiva +1.
- 10 ombrelloni per fila (numerati 1..10), totale 50 ombrelloni.
- Nomi/cognomi casuali su un sottoinsieme casuale di righe.
- Dove presente, l'email ha forma:
    matteo.posterli+Stagionale<fila><numero>@gmail.com

Output: samples/dummy-stabilimento.xlsx
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
]
COGNOMI = [
    "Rossi", "Bianchi", "Ferrari", "Russo", "Romano", "Gallo",
    "Costa", "Fontana", "Conti", "Esposito", "Marino", "Greco",
    "Bruno", "Ricci", "Moretti", "Barbieri", "Lombardi", "Colombo",
    "Fabbri", "Rinaldi", "Serra", "Caruso", "Ferrara", "Mancini",
]

FILE = ["A", "B", "C", "D", "E"]
OMBRELLONI_PER_FILA = 10
HEADERS = ["fila", "numero", "credito_giornaliero", "nome", "cognome", "telefono", "email"]


def genera_telefono(rng: random.Random) -> str:
    return "3" + "".join(str(rng.randint(0, 9)) for _ in range(9))


def main() -> None:
    rng = random.Random(42)  # seed fisso → output riproducibile
    wb = Workbook()
    ws = wb.active
    ws.title = "Ombrelloni"
    ws.append(HEADERS)

    for idx_fila, fila in enumerate(FILE):
        credito = idx_fila + 1  # A=1, B=2, C=3, D=4, E=5
        for numero in range(1, OMBRELLONI_PER_FILA + 1):
            # ~70% delle righe ha un cliente stagionale assegnato
            ha_cliente = rng.random() < 0.7
            if ha_cliente:
                nome = rng.choice(NOMI)
                cognome = rng.choice(COGNOMI)
                telefono = genera_telefono(rng)
                email = f"matteo.posterli+Stagionale{fila}{numero}@gmail.com"
            else:
                nome = cognome = telefono = email = ""
            ws.append([fila, numero, credito, nome, cognome, telefono, email])

    widths = [8, 8, 20, 16, 16, 16, 44]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    out = Path(__file__).parent / "dummy-stabilimento.xlsx"
    wb.save(out)
    print(f"Scritto {out}")


if __name__ == "__main__":
    main()
