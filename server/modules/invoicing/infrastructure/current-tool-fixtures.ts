/**
 * Redacted Solo responses recorded on #436 (2026-11-06).
 * Placeholders only. No token, OIB, address, IBAN, personal name, or live
 * invoice number, id, JIR, ZKI, or PDF.
 */

export const SOLO_OUR_REF = '{{OUR_REF}}'
export const SOLO_INVOICE_ID = '{{INVOICE_ID}}'
export const SOLO_BROJ = '{{BROJ_RACUNA}}'
export const SOLO_STORNO_ID = '{{STORNO_ID}}'
export const SOLO_STORNO_BROJ = '{{STORNO_BROJ_RACUNA}}'
export const SOLO_LINE = '{{LINE_DESC}}'

/** The create that was sent. `cijena_1` is net. Buyer fields were empty (B2C). */
export const SOLO_CREATE_REQUEST_B2C = {
  tip_usluge: '1',
  tip_racuna: '2',
  tip_kupca: '1',
  usluga: '1',
  opis_usluge_1: SOLO_LINE,
  cijena_1: '1,02',
  kolicina_1: '1',
  popust_1: '0',
  porez_stopa_1: '25',
  nacin_placanja: '1',
  napomene: SOLO_OUR_REF,
} as const

const createdRacun = {
  id: SOLO_INVOICE_ID,
  broj_racuna: SOLO_BROJ,
  tip_usluge: '1',
  tip_racuna: 'R1',
  tip_kupca: 'B2C',
  kupac_naziv: '',
  kupac_adresa: '',
  kupac_oib: '',
  usluge: [
    {
      broj: '1',
      kpd: '',
      opis_usluge: SOLO_LINE,
      jed_mjera: '-',
      kolicina: '1',
      cijena: '1,02',
      popust: '0',
      porez_stopa: '25',
      suma: '1,02',
    },
  ],
  neto_suma: '1,02',
  porezi: [{ stopa: '25', osnovica: '1,02', porez: '0,26' }],
  bruto_suma: '1,28',
  nacin_placanja: 'Transakcijski račun',
  operater: '{{OPERATOR_NAME}}',
  racun_izdao: '{{ISSUER_NAME}}',
  likvidator: '{{ISSUER_NAME}}',
  datum_racuna: '{{DATUM_RACUNA}}',
  rok_placanja: '{{ROK_PLACANJA}}',
  datum_isporuke: '{{DATUM_ISPORUKE}}',
  datum_uplate: '',
  napomene: SOLO_OUR_REF,
  ponavljanje: '0',
  iban: '{{IBAN}}',
  jezik_racuna: 'Hrvatski',
  valuta_racuna: 'EUR',
  tecaj: '1',
  status: '1',
  boja: '#ffcf03',
  zki: '{{ZKI}}',
  jir: '{{JIR}}',
  qr: '{{QR_URL}}',
  pdf: `https://solo.com.hr/download/${SOLO_INVOICE_ID}`,
}

/** `POST /racun` status 0. Labels, not the numeric ids that were sent. */
export const SOLO_CREATE_RESPONSE = {
  status: 0,
  racun: createdRacun,
  message: 'Račun uspješno kreiran.',
}

/** `GET /racun` list after create. No `napomene`. */
export const SOLO_LIST_AFTER_CREATE = {
  status: 0,
  racuni: [
    {
      id: SOLO_INVOICE_ID,
      broj_racuna: SOLO_BROJ,
      datum_racuna: '{{DATUM_RACUNA_LIST}}',
      bruto_suma: '1,28',
      status: '1',
      boja: '#ffcf03',
    },
  ],
  message: 'Prikazano _1_ od 1 računa. Stranica 1 od 0.',
}

/** `GET /racun` by id. Same `racun` as the create. */
export const SOLO_DETAIL_RESPONSE = {
  status: 0,
  racun: createdRacun,
  message: `Detalji računa _${SOLO_BROJ}_.`,
}

/** `POST /storno`. No new id. */
export const SOLO_STORNO_RESPONSE = {
  status: 0,
  message: 'Račun storniran. Provjeri u arhivi računa.',
}

/** `GET /racun` list after storno. The original list total stays positive. */
export const SOLO_LIST_AFTER_STORNO = {
  status: 0,
  racuni: [
    {
      id: SOLO_STORNO_ID,
      broj_racuna: SOLO_STORNO_BROJ,
      datum_racuna: '{{STORNO_DATUM_LIST}}',
      bruto_suma: '-1,28',
      status: '4',
      boja: '#f25555',
    },
    {
      id: SOLO_INVOICE_ID,
      broj_racuna: SOLO_BROJ,
      datum_racuna: '{{DATUM_RACUNA_LIST}}',
      bruto_suma: '1,28',
      status: '4',
      boja: '#f25555',
    },
  ],
  message: 'Prikazano _2_ od 2 računa. Stranica 1 od 0.',
}

/**
 * Storno detail. Same shape as the create, with the negations #436 recorded:
 * cijena, suma, neto, osnovica, porez, bruto, status 4, and the storno note.
 */
export const SOLO_STORNO_DETAIL = {
  status: 0,
  racun: {
    ...createdRacun,
    id: SOLO_STORNO_ID,
    broj_racuna: SOLO_STORNO_BROJ,
    usluge: [
      {
        ...createdRacun.usluge[0],
        cijena: '-1,02',
        suma: '-1,02',
      },
    ],
    neto_suma: '-1,02',
    porezi: [{ stopa: '25', osnovica: '-1,02', porez: '-0,26' }],
    bruto_suma: '-1,28',
    datum_racuna: '{{STORNO_DATUM}}',
    napomene: `Storno računa ${SOLO_BROJ}`,
    status: '4',
    boja: '#f25555',
    qr: '{{STORNO_QR_URL}}',
    pdf: `https://solo.com.hr/download/${SOLO_STORNO_ID}`,
  },
  message: `Detalji računa _${SOLO_STORNO_BROJ}_.`,
}

/** HTTP 200, no invoice. Recorded before the demo certificate was saved. */
export const SOLO_STATUS_130 = {
  status: 130,
  message: 'Odabrani način plaćanja za ovog kupca zahtjeva fiskalizaciju. Unesi certifikat, poslovnicu i operatera u Postavke > Fiskalizacija na web sučelju.',
}
