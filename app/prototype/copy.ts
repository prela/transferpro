/**
 * Both locales for the prototype screens. The strings live here so the
 * throwaway pages do not extend the product catalogues.
 */

export interface PrototypeCopy {
  branch: string
  variant: string
  row: string
  tokens: string
  frame: string
  working: string
  panel: string
  hover: string
  secondary: string
  control: string
  structural: string
  contrast: string
  light: string
  dark: string
  system: string
  language: string
  ops: string
  catalogs: string
  admin: string
  home: string
  transfers: string
  roster: string
  clients: string
  partners: string
  locations: string
  drivers: string
  vehicles: string
  prices: string
  invoices: string
  audit: string
  settings: string
  more: string
  newTransfer: string
  profile: string
  signOut: string
  company: string
  role: string
  email: string
  dayTitle: string
  startHour: string
  updated: string
  autoRefresh: string
  counts: {
    total: string
    unassigned: string
    waiting: string
    assigned: string
    progress: string
    done: string
    noShow: string
    cancelled: string
  }
  attention: string
  unassignedList: string
  waitingList: string
  progressList: string
  documents: string
  documentDriver: string
  documentVehicle: string
  note: string
  groups: Record<'past-pickup' | 'unassigned-alarm' | 'decline' | 'landing' | 'unclosed', string>
  states: Record<'unassigned' | 'assigned' | 'accepted' | 'in-progress' | 'done' | 'no-show' | 'cancelled', string>
  warnings: Record<'overlap' | 'short-gap' | 'roster-mismatch' | 'expired-document', string>
  urgentDetail: Record<'past-pickup' | 'unassigned-alarm' | 'decline' | 'landing' | 'unclosed', string>
  warningDetail: Record<'overlap' | 'short-gap' | 'roster-mismatch' | 'expired-document', string>
  actions: {
    assign: string
    confirmPhone: string
    done: string
    more: string
    correct: string
    duplicate: string
    returnRide: string
    cancel: string
    unassign: string
  }
  columns: {
    time: string
    flight: string
    guest: string
    route: string
    client: string
    driver: string
    state: string
    price: string
  }
  filters: Record<'all' | 'urgent' | 'warnings' | 'unassigned' | 'waiting' | 'progress' | 'closed', string>
  search: string
  client: string
  driver: string
  allClients: string
  allDrivers: string
  unassignedDriver: string
  empty: string
  passengers: string
  days: Record<'today' | 'tomorrow' | 'saturday' | 'yesterday', string>
  midnight: string
  payments: Record<'cash' | 'card' | 'invoice', string>
  prototypeOnly: string
  detail: string
  close: string
  directions: string
  from: string
  to: string
  luggage: string
  seats: string
  flightLanded: string
  nextRide: string
  showSign: string
  accept: string
  decline: string
  landingTime: string
  noShow: string
  noShowWhen: string
  otherRides: string
  driverTitle: string
  driverDate: string
  driverNotice: string
  confirmDone: string
  confirmDecline: string
  confirmNoShow: string
  confirmBody: string
  back: string
  signHint: string
  wake: string
}

const hr: PrototypeCopy = {
  branch: 'chore/206-prototype',
  variant: 'Varijanta',
  row: 'Redak',
  tokens: 'Tokeni',
  frame: 'Okvir',
  working: 'Radna ploha',
  panel: 'Ploča',
  hover: 'Hover / odabir',
  secondary: 'Sekundarni tekst',
  control: 'Rub kontrole',
  structural: 'Strukturni rub',
  contrast: 'Kontrast na ovoj plohi',
  light: 'Svijetla',
  dark: 'Tamna',
  system: 'Prema uređaju',
  language: 'Jezik',
  ops: 'Operativa',
  catalogs: 'Katalozi',
  admin: 'Uprava',
  home: 'Početna',
  transfers: 'Transferi',
  roster: 'Raspored',
  clients: 'Naručitelji',
  partners: 'Podizvođači',
  locations: 'Lokacije',
  drivers: 'Vozači',
  vehicles: 'Vozila',
  prices: 'Cjenik',
  invoices: 'Računi',
  audit: 'Revizija',
  settings: 'Postavke tvrtke',
  more: 'Više',
  newTransfer: 'Novi transfer',
  profile: 'Moj profil',
  signOut: 'Odjava',
  company: 'Tvrtka',
  role: 'Dispečer',
  email: 'dispecer@example.com',
  dayTitle: 'četvrtak, 15. 10. 2026.',
  startHour: 'Dan počinje u 06:00',
  updated: 'Ažurirano u 10:32',
  autoRefresh: 'Automatsko osvježavanje',
  counts: {
    total: 'Ukupno',
    unassigned: 'Nedodijeljeno',
    waiting: 'Čeka prihvat',
    assigned: 'Dodijeljeno',
    progress: 'U tijeku',
    done: 'Obavljeno',
    noShow: 'Nedolazak',
    cancelled: 'Otkazano',
  },
  attention: 'Pozornost',
  unassignedList: 'Nedodijeljeno',
  waitingList: 'Čeka prihvat',
  progressList: 'U tijeku',
  documents: 'Dokumenti koji istječu',
  documentDriver: 'Vozačka, Ivan Horvat, 2. 11.',
  documentVehicle: 'Registracija ZG-2201-CD, 28. 10.',
  note: 'Nedodijeljeno: sutra 2, sub 1',
  groups: {
    'past-pickup': 'Prošlo preuzimanje',
    'unassigned-alarm': 'Nedodijeljeno uskoro',
    'decline': 'Odbio',
    'landing': 'Slijetanje',
    'unclosed': 'Nije zatvoreno',
  },
  states: {
    'unassigned': 'Nedodijeljeno',
    'assigned': 'Čeka prihvat',
    'accepted': 'Prihvaćeno',
    'in-progress': 'U tijeku',
    'done': 'Obavljeno',
    'no-show': 'Nedolazak',
    'cancelled': 'Otkazano',
  },
  warnings: {
    'overlap': 'Preklapanje',
    'short-gap': 'Kratak razmak',
    'roster-mismatch': 'Nesklad rasporeda',
    'expired-document': 'Istekli dokumenti',
  },
  urgentDetail: {
    'past-pickup': 'Preuzimanje je prošlo, a vožnja je i dalje nedodijeljena.',
    'unassigned-alarm': 'Nedodijeljeno, preuzimanje je unutar četiri sata.',
    'decline': 'Vozač je odbio vožnju.',
    'landing': 'Let je sletio, a vozač još nije na preuzimanju.',
    'unclosed': 'Vožnja je u tijeku predugo i nije zatvorena.',
  },
  warningDetail: {
    'overlap': 'Zauzetost se preklapa s drugom vožnjom istog vozila.',
    'short-gap': 'Razmak je kraći od vremena prelaska.',
    'roster-mismatch': 'Vozilo nije ono koje raspored daje ovom vozaču.',
    'expired-document': 'Vozaču ili vozilu je istekao dokument.',
  },
  actions: {
    assign: 'Dodijeli',
    confirmPhone: 'Potvrdi telefonom',
    done: 'Obavljeno',
    more: 'Još radnji',
    correct: 'Ispravi',
    duplicate: 'Dupliciraj',
    returnRide: 'Povratni transfer',
    cancel: 'Otkaži',
    unassign: 'Ukloni dodjelu',
  },
  columns: {
    time: 'Vrijeme',
    flight: 'Let',
    guest: 'Gost',
    route: 'Relacija',
    client: 'Naručitelj',
    driver: 'Vozač · vozilo',
    state: 'Stanje',
    price: 'Cijena',
  },
  filters: {
    all: 'Sve',
    urgent: 'Hitno',
    warnings: 'Upozorenja',
    unassigned: 'Nedodijeljeno',
    waiting: 'Čeka prihvat',
    progress: 'U tijeku',
    closed: 'Zatvoreno',
  },
  search: 'Gost, let, referenca, tabla',
  client: 'Naručitelj',
  driver: 'Vozač',
  allClients: 'Svi naručitelji',
  allDrivers: 'Svi vozači',
  unassignedDriver: 'Nedodijeljeno',
  empty: 'Nema vožnji za ovaj filtar.',
  passengers: 'putnika',
  days: {
    today: 'danas',
    tomorrow: 'sutra',
    saturday: 'sub',
    yesterday: 'jučer',
  },
  midnight: '16. 10.',
  payments: {
    cash: 'Gotovina',
    card: 'Kartica',
    invoice: 'Račun agenciji',
  },
  prototypeOnly: 'Prototip ne sprema naredbu.',
  detail: 'Detalj vožnje',
  close: 'Zatvori',
  directions: 'Upute',
  from: 'Od',
  to: 'Do',
  luggage: 'Prtljaga',
  seats: 'Sjedalice',
  flightLanded: 'Let',
  nextRide: 'Sljedeća vožnja',
  showSign: 'Prikaži tablu',
  accept: 'Prihvati',
  decline: 'Odbij',
  landingTime: 'Vrijeme slijetanja',
  noShow: 'Nedolazak',
  noShowWhen: 'Od 11:15, čekanje još traje',
  otherRides: 'Ostale vožnje',
  driverTitle: 'Jadran transferi',
  driverDate: 'četvrtak, 15. 10.',
  driverNotice: 'Vozačka ističe 2. 11.',
  confirmDone: 'Označiti obavljenom?',
  confirmDecline: 'Odbiti ovu vožnju?',
  confirmNoShow: 'Označiti nedolazak?',
  confirmBody: 'Ovo u prototipu ništa ne sprema.',
  back: 'Natrag',
  signHint: 'Držite telefon kao tablu. Tekst prati širinu zaslona.',
  wake: 'Zaslon ostaje upaljen gdje preglednik to dopušta.',
}

const en: PrototypeCopy = {
  branch: 'chore/206-prototype',
  variant: 'Variant',
  row: 'Row',
  tokens: 'Tokens',
  frame: 'Frame',
  working: 'Working surface',
  panel: 'Panel',
  hover: 'Hover / selected',
  secondary: 'Secondary text',
  control: 'Control border',
  structural: 'Structural border',
  contrast: 'Contrast on this surface',
  light: 'Light',
  dark: 'Dark',
  system: 'Follow the device',
  language: 'Language',
  ops: 'Operations',
  catalogs: 'Catalogues',
  admin: 'Administration',
  home: 'Home',
  transfers: 'Transfers',
  roster: 'Roster',
  clients: 'Clients',
  partners: 'Subcontractors',
  locations: 'Locations',
  drivers: 'Drivers',
  vehicles: 'Vehicles',
  prices: 'Price list',
  invoices: 'Invoices',
  audit: 'Audit',
  settings: 'Company settings',
  more: 'More',
  newTransfer: 'New transfer',
  profile: 'My profile',
  signOut: 'Sign out',
  company: 'Company',
  role: 'Dispatcher',
  email: 'dispatcher@example.com',
  dayTitle: 'Thursday, 15 Oct 2026',
  startHour: 'The day starts at 06:00',
  updated: 'Updated at 10:32',
  autoRefresh: 'Automatic refresh',
  counts: {
    total: 'Total',
    unassigned: 'Unassigned',
    waiting: 'Waiting',
    assigned: 'Assigned',
    progress: 'In progress',
    done: 'Done',
    noShow: 'No-show',
    cancelled: 'Cancelled',
  },
  attention: 'Attention',
  unassignedList: 'Unassigned',
  waitingList: 'Waiting on acceptance',
  progressList: 'In progress',
  documents: 'Documents expiring',
  documentDriver: 'Licence, Ivan Horvat, 2 Nov',
  documentVehicle: 'Registration ZG-2201-CD, 28 Oct',
  note: 'Unassigned: tomorrow 2, Sat 1',
  groups: {
    'past-pickup': 'Pickup has passed',
    'unassigned-alarm': 'Unassigned soon',
    'decline': 'Declined',
    'landing': 'Landing',
    'unclosed': 'Not closed',
  },
  states: {
    'unassigned': 'Unassigned',
    'assigned': 'Waiting on acceptance',
    'accepted': 'Accepted',
    'in-progress': 'In progress',
    'done': 'Done',
    'no-show': 'No-show',
    'cancelled': 'Cancelled',
  },
  warnings: {
    'overlap': 'Overlap',
    'short-gap': 'Short gap',
    'roster-mismatch': 'Roster mismatch',
    'expired-document': 'Expired documents',
  },
  urgentDetail: {
    'past-pickup': 'The pickup has passed and the ride is still unassigned.',
    'unassigned-alarm': 'Unassigned, and the pickup is inside four hours.',
    'decline': 'The driver declined the ride.',
    'landing': 'The flight has landed and the driver is not at the pickup.',
    'unclosed': 'The ride has been in progress too long and is not closed.',
  },
  warningDetail: {
    'overlap': 'The occupation overlaps another ride of the same vehicle.',
    'short-gap': 'The gap is shorter than the relocation time.',
    'roster-mismatch': 'The vehicle is not the one the roster gives this driver.',
    'expired-document': 'The driver or the vehicle has an expired document.',
  },
  actions: {
    assign: 'Assign',
    confirmPhone: 'Confirm by phone',
    done: 'Done',
    more: 'More actions',
    correct: 'Correct',
    duplicate: 'Duplicate',
    returnRide: 'Return transfer',
    cancel: 'Cancel',
    unassign: 'Unassign',
  },
  columns: {
    time: 'Time',
    flight: 'Flight',
    guest: 'Guest',
    route: 'Route',
    client: 'Client',
    driver: 'Driver · vehicle',
    state: 'State',
    price: 'Price',
  },
  filters: {
    all: 'All',
    urgent: 'Urgent',
    warnings: 'Warnings',
    unassigned: 'Unassigned',
    waiting: 'Waiting',
    progress: 'In progress',
    closed: 'Closed',
  },
  search: 'Guest, flight, reference, sign',
  client: 'Client',
  driver: 'Driver',
  allClients: 'All clients',
  allDrivers: 'All drivers',
  unassignedDriver: 'Unassigned',
  empty: 'No rides match this filter.',
  passengers: 'passengers',
  days: {
    today: 'today',
    tomorrow: 'tomorrow',
    saturday: 'Sat',
    yesterday: 'yesterday',
  },
  midnight: '16 Oct',
  payments: {
    cash: 'Cash',
    card: 'Card',
    invoice: 'Invoice to agency',
  },
  prototypeOnly: 'The prototype does not save this command.',
  detail: 'Ride detail',
  close: 'Close',
  directions: 'Directions',
  from: 'From',
  to: 'To',
  luggage: 'Luggage',
  seats: 'Child seats',
  flightLanded: 'Flight',
  nextRide: 'Next ride',
  showSign: 'Show the sign',
  accept: 'Accept',
  decline: 'Decline',
  landingTime: 'Landing time',
  noShow: 'No-show',
  noShowWhen: 'From 11:15, the wait has not passed',
  otherRides: 'Other rides',
  driverTitle: 'Jadran transferi',
  driverDate: 'Thursday, 15 Oct',
  driverNotice: 'Licence expires on 2 Nov.',
  confirmDone: 'Mark this ride done?',
  confirmDecline: 'Decline this ride?',
  confirmNoShow: 'Mark a no-show?',
  confirmBody: 'The prototype saves nothing.',
  back: 'Back',
  signHint: 'Hold the phone up as the meet sign. The text fits the screen width.',
  wake: 'The screen stays on where the browser allows it.',
}

export function prototypeCopy(locale: string): PrototypeCopy {
  return locale === 'en' ? en : hr
}
