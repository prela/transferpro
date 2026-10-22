# Croatian invoicing duties for an invoice to an agency

Finding for research #225, step 3 of #206. Researched on 22 October 2026 from primary sources only. Each claim carries a source tag `[Sn]` that resolves under **Sources**. **UNVERIFIED** marks what no primary source confirmed. This is not legal or tax advice; the open points go to the Tenant's accountant.

The question: a Croatian transfer company issues one invoice per done Transfer to the agency or hotel that booked it, paid by bank transfer. Cash and card receipts to guests stay in the company's till tool. Which duties apply, and who can carry them out through an API?

This finding names no vendor. Certified information intermediaries are listed only in the official register [S7]. ADR-0051 decides how v1 issues invoices and records the intermediary route as post-v1.

## Summary

- **An invoice to a Croatian agency or hotel from an issuer in the VAT register is a structured eRačun** (UBL 2.1, EN 16931 with the CIUS-HR extensions), fiscalized at the moment of issue. This has applied since 1.1.2026 to a domestic transaction: a supply subject to Croatian VAT where both sides have a seat in Croatia. A PDF by email is no longer a valid invoice for them [S1 Arts 2(34), 38, 48(3), 80][S2]. An issuer outside the VAT register must receive eRačun from 1.1.2026 and issue them from 1.1.2027 [S1 Art 80][S2].
- **The issuer reports each payment received on an eRačun (eNaplata)** for the previous month by the 20th. The receiver reports rejections (eOdbijanje) on the same deadline [S1 Arts 52, 53].
- **A foreign agency, EU or not, gets an ordinary invoice**: no eRačun and no payment report, and by definition no B2C fiscalization (open point 1). The buyer has no seat in Croatia, so the supply is not a domestic transaction [S1 Art 2(24), 2(34)][S2 Q13][S3]. The Ride is still taxed in Croatia, because passenger transport is taxed where it is performed [S12 Arts 20, 38].
- **A Croatian individual who pays by bank transfer needs a B2C fiscalized invoice** (JIR, ZKI, QR code) since 1.1.2026, whatever the payment method. Signing it needs the company's own application certificate [S1 Arts 2(26), 3, 80][S5][S8].
- **Domestic road passenger transport is taxed at 25% in 2026.** It is not on the 13% or 5% lists, and international road passenger transport is not exempt [S12 Arts 38, 43(2)].
- **An issued invoice is never edited or deleted.** A correction is a new document, a storno or a credit note, which is itself an invoice and is fiscalized [S12 Art 78(7)][S1 Arts 14(2), 24, 52(4)][S10]. Software that can change an issued invoice is treated as a means of avoiding fiscalization [S1 Art 14(2)].
- **Keep invoices for 11 years in Croatia or another EU state.** The Fiscalization Act asks 6 years for eRačun in original XML [S1 Art 35]; the Accounting Act asks at least 11 years for outgoing invoices [S14 Art 10].
- **An information intermediary sends, receives, and fiscalizes eRačun for a company** under a contract. The company confirms it in FiskAplikacija (through ePorezna) and may grant it fiscalization authority; then the company needs no certificate of its own for eRačun [S1 Art 2(14)][S5][S7][S9 Art 10]. One intermediary may serve any number of companies, each under its own contract and authorisation [S1 Art 2(14)][S3][S7].
- **The official register lists the certified intermediaries** (updated 16.10.2026) [S7]. Listing requires ISO/IEC 27001, a GDPR Article 32 security document, and data kept in the EU [S1 Arts 60–62].

## Duties

### Who issues and receives eRačun, and from when

| Issuer | Receive eRačun | Issue and fiscalize eRačun | Source |
|---|---|---|---|
| In the VAT register, seat in Croatia | from 1.1.2026 | from 1.1.2026 | [S1 Arts 38(1)(1), 80][S2] |
| Outside the VAT register | from 1.1.2026 | from 1.1.2027 | [S1 Arts 38(1)(2), 80][S2] |
| Foreign business with only a Croatian VAT number | not covered | not covered | [S1 Art 38][S2] |

- The duty covers only a domestic transaction, and all three conditions must hold at once [S1 Art 2(34)][S2 Q13].
- A cash or card sale fiscalized as a B2C receipt gets no eRačun as well [S1 Art 39]. A bank-transfer invoice is not such a sale.
- The tax authority has published how it treats errors in the first period [S6]; how far that reaches in late 2026 is **UNVERIFIED**.

### Fiscalization and reporting

- The issuer fiscalizes an eRačun at the moment of issue, separately from sending it. The receiver fiscalizes within 5 working days of receipt [S1 Art 48(3), 48(4)][S4]. After an outage both have 5 working days [S1 Art 49(1)].
- eIzvještavanje carries three messages: payment, rejection, and a supply for which no eRačun could be delivered [S11].
- eNaplata: payments received in the previous month by the 20th; partial payments and negative corrections are possible [S1 Art 53(1)][S3].
- eOdbijanje: rejections of the previous month by the 20th. The issuer may storno a rejected eRačun and issue a new one [S1 Art 52].
- A buyer missing from the address register cannot receive an eRačun. The issuer then issues another form of invoice and reports the supply through eIzvještavanje [S1 Art 40][S3].

### Buyer cases for a non-cash invoice

| Buyer | eRačun | B2C fiscalization | Reporting | VAT on a Ride in Croatia | Source |
|---|---|---|---|---|---|
| Croatian agency or hotel | yes, from a VAT-registered issuer | no | payment by the 20th | 25% | [S1 Arts 2(34), 38, 53][S12 Art 38] |
| EU agency | no | no (see open point 1) | no | 25% Croatian VAT | [S2 Q13][S3][S12 Art 20] |
| Non-EU agency | no | no (see open point 1) | no | 25% Croatian VAT | as above |
| Croatian individual, bank transfer | no | yes, payment method T | no | 25% | [S1 Arts 2(26), 3, 80][S5] |
| Foreign individual, bank transfer | no | yes (inferred) | no | 25% | [S5][S12 Art 20] |

In a B2C fiscalization with payment method T, the buyer's OIB is not sent [S8].

### Mandatory content

VAT Act Article 79(1) [S12]: invoice number and issue date; seller name, address, and OIB or VAT id; buyer name, address, and OIB or VAT id; type and extent of the service; date of supply when it differs from the issue date; unit price without VAT by rate; discounts; VAT rate; VAT amount by rate; total. The seller's OIB is always required, and the VAT id for an intra-EU supply [S12 Art 79(2)].

Fiscalization Act [S1 Arts 7–9][S3]: time of issue (hour and minute); an operator mark tied to the operator's OIB in an internal act; payment method; a three-part number (number, premises, device) in an unbroken sequence per premises or device, with the rules set in an internal act. B2C invoices also carry JIR, ZKI, and a QR code.

CIUS-HR extras on an eRačun [S10]: issue time, operator mark and operator OIB, the business process code, a KPD 2025 code on each line, the payment account, the due date when an amount is payable, and the Croatian VAT breakdown.

### Storno and correction

A document that changes an invoice and refers to it is itself an invoice, issued and fiscalized like one [S12 Art 78(7)]. In eRačun it is a CreditNote, or an Invoice of a corrective type, with process P9 or P10 and a reference to the original [S10]. B2C invoices allow negative amounts [S1 Art 24]. Bookkeeping records are not changed in a way that hides their first content [S13 Art 66].

### Archive

6 years for eRačun in original XML under the Fiscalization Act [S1 Art 35(1)]; 10 years for business records under the General Tax Act [S13 Art 66]; at least 11 years for outgoing invoices, in Croatia or another EU state, under the Accounting Act [S14 Art 10].

## Certified intermediaries

The official register is the only list this finding gives: "Popis informacijskih posrednika" [S7]. Entry requires a conformity test and the documents in [S1 Arts 60–61]; an intermediary leaves the register when its ISO/IEC 27001 certificate lapses [S1 Art 62]. Comparing intermediaries' APIs, sandboxes, and prices is left to the post-v1 intermediary work in ADR-0051.

## Open points for the accountant

1. An invoice to a foreign agency that carries Croatian VAT: by the definition in [S1 Art 2(26)] it needs no B2C fiscalization, but no tax-authority answer covers this exact case.
2. The KPD 2025 code for a transfer service on an eRačun line. The candidate is group 49.3, other passenger land transport; the six-digit code is **UNVERIFIED**.
3. A foreign individual paying by bank transfer is inferred to need B2C fiscalization. v1 refuses an individual Client, so this does not reach the product.

## Sources

- [S1] Zakon o fiskalizaciji, NN 89/2025 — https://narodne-novine.nn.hr/clanci/sluzbeni/2025_06_89_1233.html
- [S2] Porezna uprava, Izdavatelji i primatelji eRačuna te obveza izdavanja eRačuna — https://porezna-uprava.gov.hr/hr/izdavatelji-i-primatelji-eracuna-te-obveza-izdavanja-eracuna-azurirano-17-4-2026/8048
- [S3] Porezna uprava, Izdavanje i primanje eRačuna i fiskalizacija eRačuna — https://porezna-uprava.gov.hr/hr/izdavanje-i-primanje-eracuna-i-fiskalizacija-eracuna/8047
- [S4] Porezna uprava, Fiskalizacija eRačuna — https://porezna-uprava.gov.hr/hr/fiskalizacija-eracuna-azurirano-5-6-2026/8049
- [S5] Porezna uprava, Fiskalizacija računa u krajnjoj potrošnji – B2C poslovanje — https://porezna-uprava.gov.hr/hr/fiskalizacija-racuna-u-krajnjoj-potrosnji-b2c-poslovanje/8033
- [S6] Porezna uprava, Obveza izdavanja i zaprimanja eRačuna — https://porezna-uprava.gov.hr/hr/obveza-izdavanja-i-zaprimanja-eracuna/8327
- [S7] Porezna uprava, Popis informacijskih posrednika — https://porezna-uprava.gov.hr/hr/popis-informacijskih-posrednika/8019
- [S8] Pravilnik o fiskalizaciji računa u krajnjoj potrošnji, NN 153/2025 — https://narodne-novine.nn.hr/clanci/sluzbeni/2025_12_153_2278.html
- [S9] Pravilnik o eRačunu, NN 11/2026 — https://narodne-novine.nn.hr/clanci/sluzbeni/2026_01_11_88.html
- [S10] Ministarstvo financija, Specifikacija osnovne uporabe eRačuna s proširenjima (CIUS-HR) — https://porezna.gov.hr/fiskalizacija/api/dokumenti/183
- [S11] Tehnička specifikacija Fiskalizacija eRačuna i eIzvještavanje — https://porezna.gov.hr/fiskalizacija/api/dokumenti/186
- [S12] Zakon o porezu na dodanu vrijednost, NN 73/2013 and amendments — https://narodne-novine.nn.hr/clanci/sluzbeni/2013_06_73_1451.html
- [S13] Opći porezni zakon, NN 115/2016 — https://narodne-novine.nn.hr/clanci/sluzbeni/2016_12_115_2519.html
- [S14] Zakon o računovodstvu, NN 85/2024 — https://narodne-novine.nn.hr/clanci/sluzbeni/full/2024_07_85_1474.html
