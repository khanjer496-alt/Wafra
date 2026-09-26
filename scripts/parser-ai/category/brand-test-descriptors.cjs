'use strict';
/**
 * Held-out descriptors for the curated brand table (src/lib/brand-categories.ts).
 *
 * Independent of the phase-1 set (merchants.cjs): brand names are written as a
 * shopper would see them, then rendered through statement/alert noise
 * (POS prefixes, processor prefixes, store and terminal numbers, city and
 * country suffixes, 22-character truncation, lower-case app-push text).
 *
 * `inTable: true`  — a brand the table is meant to know. Scores coverage/accuracy.
 * `inTable: false` — a real or plausible merchant deliberately NOT in the table,
 *                    including look-alikes of gated short tokens (DIAMOND,
 *                    ACTION PLUMBING, TARGET RANGE...). The brand layer should
 *                    stay silent on these; when it fires, that is measured.
 * Labels are the app's category ids, from public knowledge of the business.
 */

// [surface name, category, inTable]
const B = {
  US: {
    city: 'NEW YORK', cc: 'US', rows: [
      ['Wegmans', 'groceries', 1], ['Harris Teeter', 'groceries', 1], ['Meijer', 'groceries', 1], ['Food Lion', 'groceries', 1], ['Stop & Shop', 'groceries', 1],
      ['Raising Cane\'s', 'dining', 1], ['Jersey Mike\'s', 'dining', 1], ['Olive Garden', 'dining', 1], ['Cracker Barrel', 'dining', 1], ['Dutch Bros', 'dining', 1],
      ['Sunoco', 'transport', 1], ['Valero', 'transport', 1], ['E-ZPass NY', 'transport', 1], ['NJ Transit', 'transport', 1], ['Jiffy Lube', 'transport', 1],
      ['Rite Aid', 'health', 1], ['Labcorp', 'health', 1], ['Lowe\'s', 'shopping', 1], ['Nordstrom', 'shopping', 1], ['Wayfair', 'shopping', 1], ['Chewy', 'shopping', 1], ['Dollar Tree', 'shopping', 1],
      ['Cricket Wireless', 'telecom', 1], ['Xfinity', 'telecom', 1], ['Duke Energy', 'utilities', 1], ['Eversource', 'utilities', 1], ['Cinemark', 'entertainment', 1], ['SiriusXM', 'entertainment', 1],
      ['Southwest Airlines', 'travel', 1], ['JetBlue', 'travel', 1], ['TaskRabbit', 'home-services', 1], ['Terminix', 'home-services', 1],
      ['Bojangles', 'dining', 0], ['Bristol Farms', 'groceries', 0], ['Diamond Dry Cleaners', 'home-services', 0], ['Action Plumbing', 'home-services', 0], ['Tim\'s Hardware', 'shopping', 0], ['Coop Brewing Co', 'dining', 0], ['Jumbo Car Wash', 'transport', 0],
    ],
  },
  CA: {
    city: 'TORONTO', cc: 'CA', rows: [
      ['Sobeys', 'groceries', 1], ['FreshCo', 'groceries', 1], ['Farm Boy', 'groceries', 1], ['Save-On-Foods', 'groceries', 1], ['LCBO', 'groceries', 1],
      ['Harvey\'s', 'dining', 1], ['Swiss Chalet', 'dining', 1], ['Second Cup', 'dining', 1], ['Petro-Canada', 'transport', 1], ['GO Transit', 'transport', 1],
      ['Jean Coutu', 'health', 1], ['Dollarama', 'shopping', 1], ['Sport Chek', 'shopping', 1], ['Telus Mobility', 'telecom', 1], ['Koodo Mobile', 'telecom', 1], ['BC Hydro', 'utilities', 1], ['Porter Airlines', 'travel', 1],
      ['Pusateri\'s', 'groceries', 0], ['Mandarin Restaurant', 'dining', 0], ['Heritage Cleaners', 'home-services', 0],
    ],
  },
  GB: {
    city: 'LONDON', cc: 'GB', rows: [
      ['Sainsbury\'s Local', 'groceries', 1], ['Morrisons Daily', 'groceries', 1], ['Co-op Food', 'groceries', 1], ['Iceland Foods', 'groceries', 1], ['Budgens', 'groceries', 1],
      ['Caffe Nero', 'dining', 1], ['Pizza Express', 'dining', 1], ['Wetherspoon', 'dining', 1], ['Itsu', 'dining', 1], ['Wagamama', 'dining', 1],
      ['Trainline', 'transport', 1], ['Avanti West Coast', 'transport', 1], ['RingGo', 'transport', 1], ['Stagecoach', 'transport', 1], ['Superdrug', 'health', 1], ['PureGym', 'health', 1],
      ['Screwfix', 'shopping', 1], ['Dunelm', 'shopping', 1], ['Waterstones', 'shopping', 1], ['Poundland', 'shopping', 1], ['Giffgaff', 'telecom', 1], ['TalkTalk', 'telecom', 1],
      ['Octopus Energy', 'utilities', 1], ['Severn Trent', 'utilities', 1], ['Cineworld', 'entertainment', 1], ['Travelodge', 'travel', 1], ['DVLA', 'government', 1],
      ['Gail\'s Bakery', 'dining', 1], ['Lidl GB', 'groceries', 1],
      ['Target Shooting Range', 'entertainment', 0], ['The Crown Inn', 'dining', 0], ['Mortons Butchers', 'groceries', 0], ['Chapter One Books', 'shopping', 0],
    ],
  },
  IE: {
    city: 'DUBLIN', cc: 'IE', rows: [
      ['Dunnes Stores', 'groceries', 1], ['SuperValu', 'groceries', 1], ['Centra', 'groceries', 1], ['Applegreen', 'transport', 1], ['Leap Card', 'transport', 1],
      ['Supermac\'s', 'dining', 1], ['Penneys', 'shopping', 1], ['Electric Ireland', 'utilities', 1], ['Aer Lingus', 'travel', 1],
      ['Kavanaghs Pharmacy', 'health', 0], ['The Brazen Head', 'dining', 0],
    ],
  },
  FR: {
    city: 'PARIS', cc: 'FR', rows: [
      ['Carrefour City', 'groceries', 1], ['Monoprix', 'groceries', 1], ['Franprix', 'groceries', 1], ['Intermarché', 'groceries', 1], ['Super U', 'groceries', 1], ['Biocoop', 'groceries', 1],
      ['Brioche Dorée', 'dining', 1], ['Buffalo Grill', 'dining', 1], ['Flunch', 'dining', 1], ['SNCF Connect', 'transport', 1], ['RATP', 'transport', 1], ['Vinci Autoroutes', 'transport', 1],
      ['Doctolib', 'health', 1], ['Fnac', 'shopping', 1], ['Castorama', 'shopping', 1], ['Kiabi', 'shopping', 1], ['Cdiscount', 'shopping', 1],
      ['Bouygues Telecom', 'telecom', 1], ['Free Mobile', 'telecom', 1], ['Engie', 'utilities', 1], ['UGC Ciné Cité', 'entertainment', 1], ['Nocibé', 'personal-care', 1], ['Transavia', 'travel', 1],
      ['Le Petit Zinc', 'dining', 0], ['Fromagerie Laurent', 'groceries', 0], ['Garage Dupont', 'transport', 0], ['Orangerie du Parc', 'dining', 0],
    ],
  },
  DE: {
    city: 'BERLIN', cc: 'DE', rows: [
      ['REWE', 'groceries', 1], ['EDEKA', 'groceries', 1], ['Kaufland', 'groceries', 1], ['Penny Markt', 'groceries', 1], ['Alnatura', 'groceries', 1],
      ['Nordsee', 'dining', 1], ['BackWerk', 'dining', 1], ['L\'Osteria', 'dining', 1], ['Deutsche Bahn', 'transport', 1], ['Aral', 'transport', 1], ['Share Now', 'transport', 1],
      ['DocMorris', 'health', 1], ['Fielmann', 'health', 1], ['dm-drogerie markt', 'personal-care', 1], ['Rossmann', 'personal-care', 1],
      ['Hornbach', 'shopping', 1], ['Deichmann', 'shopping', 1], ['Thalia', 'shopping', 1], ['Congstar', 'telecom', 1], ['Vattenfall', 'utilities', 1], ['CineStar', 'entertainment', 1], ['Eurowings', 'travel', 1],
      ['Späti am Eck', 'groceries', 0], ['Metzgerei Huber', 'groceries', 0], ['Döner Kebap Haus', 'dining', 0], ['Mueller Schreinerei', 'home-services', 0],
    ],
  },
  ES: {
    city: 'MADRID', cc: 'ES', rows: [
      ['Mercadona', 'groceries', 1], ['Eroski', 'groceries', 1], ['Ahorramas', 'groceries', 1], ['Supermercados Dia', 'groceries', 1], ['Condis', 'groceries', 1],
      ['Telepizza', 'dining', 1], ['Rodilla', 'dining', 1], ['Goiko', 'dining', 1], ['Renfe', 'transport', 1], ['Cepsa', 'transport', 1], ['Ballenoil', 'transport', 1],
      ['El Corte Inglés', 'shopping', 1], ['Bricomart', 'shopping', 1], ['Worten', 'shopping', 1], ['Druni', 'personal-care', 1], ['Yoigo', 'telecom', 1], ['Endesa', 'utilities', 1], ['Cinesa', 'entertainment', 1], ['Air Europa', 'travel', 1],
      ['Bar Casa Pepe', 'dining', 0], ['Diamante Joyeros', 'shopping', 0], ['Ferreteria Lopez', 'shopping', 0], ['Dia Hostal', 'travel', 0],
    ],
  },
  IT: {
    city: 'MILANO', cc: 'IT', rows: [
      ['Esselunga', 'groceries', 1], ['Conad', 'groceries', 1], ['Eurospin', 'groceries', 1], ['Coop', 'groceries', 1], ['NaturaSì', 'groceries', 1],
      ['Autogrill', 'dining', 1], ['Spontini', 'dining', 1], ['Trenitalia', 'transport', 1], ['Italo Treno', 'transport', 1], ['Telepass', 'transport', 1],
      ['MediaWorld', 'shopping', 1], ['Calzedonia', 'shopping', 1], ['Feltrinelli', 'shopping', 1], ['Tigotà', 'personal-care', 1], ['WindTre', 'telecom', 1], ['Iliad', 'telecom', 1], ['Hera Comm', 'utilities', 1], ['UCI Cinemas', 'entertainment', 1],
      ['Trattoria da Luigi', 'dining', 0], ['Macelleria Rossi', 'groceries', 0], ['Tabacchi 21', 'shopping', 0],
    ],
  },
  NL: {
    city: 'AMSTERDAM', cc: 'NL', rows: [
      ['Albert Heijn', 'groceries', 1], ['Jumbo', 'groceries', 1], ['Dirk', 'groceries', 1], ['Hoogvliet', 'groceries', 1], ['Vomar', 'groceries', 1],
      ['FEBO', 'dining', 1], ['Smullers', 'dining', 1], ['NS Reizigers', 'transport', 1], ['GVB', 'transport', 1], ['Swapfiets', 'transport', 1],
      ['Kruidvat', 'personal-care', 1], ['Etos', 'personal-care', 1], ['HEMA', 'shopping', 1], ['Blokker', 'shopping', 1], ['Praxis', 'shopping', 1], ['Wehkamp', 'shopping', 1],
      ['Odido', 'telecom', 1], ['Essent', 'utilities', 1], ['Belastingdienst', 'government', 1], ['Bitvavo', 'investing', 1],
      ['Eetcafe De Hoek', 'dining', 0], ['Slagerij Van Dam', 'groceries', 0], ['Fietsenmaker Jan', 'transport', 0],
    ],
  },
  BE: {
    city: 'BRUXELLES', cc: 'BE', rows: [
      ['Delhaize', 'groceries', 1], ['Colruyt', 'groceries', 1], ['Okay', 'groceries', 1], ['Exki', 'dining', 1], ['SNCB', 'transport', 1], ['STIB', 'transport', 1],
      ['Krëfel', 'shopping', 1], ['Proximus', 'telecom', 1], ['Telenet', 'telecom', 1], ['Luminus', 'utilities', 1],
      ['Friterie Chez Martin', 'dining', 0], ['Boucherie Lambert', 'groceries', 0],
    ],
  },
  CH: {
    city: 'ZURICH', cc: 'CH', rows: [
      ['Migros', 'groceries', 1], ['Coop', 'groceries', 1], ['Denner', 'groceries', 1], ['Volg', 'groceries', 1], ['SBB CFF FFS', 'transport', 1], ['ZVV', 'transport', 1],
      ['Galaxus', 'shopping', 1], ['Digitec', 'shopping', 1], ['Jumbo', 'shopping', 1], ['Swisscom', 'telecom', 1], ['Amavita', 'health', 1],
      ['Confiserie Sprüngli', 'dining', 0], ['Bäckerei Kleiner', 'dining', 0],
    ],
  },
  PT: {
    city: 'LISBOA', cc: 'PT', rows: [
      ['Continente', 'groceries', 1], ['Pingo Doce', 'groceries', 1], ['Minipreço', 'groceries', 1], ['Via Verde', 'transport', 1], ['Galp', 'transport', 1],
      ['Worten', 'shopping', 1], ['Radio Popular', 'shopping', 1], ['MEO', 'telecom', 1], ['NOS', 'telecom', 1], ['EDP Comercial', 'utilities', 1],
      ['Pastelaria Aloma', 'dining', 0], ['Talho Central', 'groceries', 0],
    ],
  },
  TR: {
    city: 'ISTANBUL', cc: 'TR', rows: [
      ['Migros', 'groceries', 1], ['BİM', 'groceries', 1], ['A101', 'groceries', 1], ['ŞOK Market', 'groceries', 1], ['Macrocenter', 'groceries', 1],
      ['Simit Sarayı', 'dining', 1], ['Kahve Dünyası', 'dining', 1], ['Opet', 'transport', 1], ['Petrol Ofisi', 'transport', 1], ['İstanbulkart', 'transport', 1],
      ['Trendyol', 'shopping', 1], ['Hepsiburada', 'shopping', 1], ['LC Waikiki', 'shopping', 1], ['Koçtaş', 'shopping', 1], ['Turkcell', 'telecom', 1], ['Enerjisa', 'utilities', 1], ['İGDAŞ', 'utilities', 1], ['SunExpress', 'travel', 1],
      ['Ali Usta Kebap', 'dining', 0], ['Yildiz Kasap', 'groceries', 0], ['Bim Kuaför', 'personal-care', 0],
    ],
  },
  BR: {
    city: 'SAO PAULO', cc: 'BR', rows: [
      ['Pão de Açúcar', 'groceries', 1], ['Assaí Atacadista', 'groceries', 1], ['Atacadão', 'groceries', 1], ['Zaffari', 'groceries', 1], ['Extra', 'groceries', 1],
      ['Giraffas', 'dining', 1], ['Coco Bambu', 'dining', 1], ['iFood', 'dining', 1], ['Ipiranga', 'transport', 1], ['Sem Parar', 'transport', 1], ['99 App', 'transport', 1],
      ['Drogasil', 'health', 1], ['Pague Menos', 'health', 1], ['Magazine Luiza', 'shopping', 1], ['Casas Bahia', 'shopping', 1], ['Netshoes', 'shopping', 1],
      ['O Boticário', 'personal-care', 1], ['Vivo', 'telecom', 1], ['Sabesp', 'utilities', 1], ['Cemig', 'utilities', 1], ['Detran SP', 'government', 1], ['Azul Linhas Aereas', 'travel', 1],
      ['Padaria Bella Vista', 'dining', 0], ['Acougue Boi Gordo', 'groceries', 0], ['Lanchonete do Ze', 'dining', 0],
    ],
  },
  MX: {
    city: 'CDMX', cc: 'MX', rows: [
      ['OXXO', 'groceries', 1], ['Soriana', 'groceries', 1], ['Chedraui', 'groceries', 1], ['Bodega Aurrera', 'groceries', 1], ['La Comer', 'groceries', 1],
      ['Toks', 'dining', 1], ['Italianni\'s', 'dining', 1], ['Pemex', 'transport', 1], ['TeleVía', 'transport', 1], ['Farmacias del Ahorro', 'health', 1], ['Farmacias Similares', 'health', 1],
      ['Liverpool', 'shopping', 1], ['Coppel', 'shopping', 1], ['Palacio de Hierro', 'shopping', 1], ['Telcel', 'telecom', 1], ['Izzi', 'telecom', 1], ['CFE', 'utilities', 1], ['Cinemex', 'entertainment', 1], ['Volaris', 'travel', 1],
      ['Tacos El Guero', 'dining', 0], ['Abarrotes Lupita', 'groceries', 0], ['Tlapaleria Juarez', 'shopping', 0],
    ],
  },
  CO: {
    city: 'BOGOTA', cc: 'CO', rows: [
      ['Éxito', 'groceries', 1], ['Carulla', 'groceries', 1], ['D1', 'groceries', 1], ['Ara', 'groceries', 1], ['Juan Valdez', 'dining', 1], ['Frisby', 'dining', 1],
      ['Terpel', 'transport', 1], ['TransMilenio', 'transport', 1], ['Cruz Verde', 'health', 1], ['Falabella', 'shopping', 1], ['Alkosto', 'shopping', 1], ['Tigo', 'telecom', 1], ['EPM', 'utilities', 1],
      ['Panaderia La Esperanza', 'dining', 0], ['Drogueria San Jorge', 'health', 0], ['Corrientazo Dona Rosa', 'dining', 0],
    ],
  },
  AR: {
    city: 'BUENOS AIRES', cc: 'AR', rows: [
      ['Coto', 'groceries', 1], ['Día', 'groceries', 1], ['Disco', 'groceries', 1], ['Changomas', 'groceries', 1], ['Havanna', 'dining', 1], ['Café Martínez', 'dining', 1],
      ['YPF', 'transport', 1], ['Carga SUBE', 'transport', 1], ['Farmacity', 'health', 1], ['Frávega', 'shopping', 1], ['Personal', 'telecom', 1], ['Edenor', 'utilities', 1], ['Flybondi', 'travel', 1],
      ['Parrilla Don Julio', 'dining', 0], ['Kiosco El Sol', 'groceries', 0],
    ],
  },
  IN: {
    city: 'BENGALURU', cc: 'IN', rows: [
      ['BigBasket', 'groceries', 1], ['DMart', 'groceries', 1], ['Swiggy Instamart', 'groceries', 1], ['JioMart', 'groceries', 1], ['Star Bazaar', 'groceries', 1],
      ['Haldiram\'s', 'dining', 1], ['Chaayos', 'dining', 1], ['Third Wave Coffee', 'dining', 1], ['Barbeque Nation', 'dining', 1], ['Rapido', 'transport', 1], ['Bharat Petroleum', 'transport', 1], ['Namma Metro', 'transport', 1],
      ['Netmeds', 'health', 1], ['Lenskart', 'health', 1], ['Cult.fit', 'health', 1], ['Ajio', 'shopping', 1], ['Meesho', 'shopping', 1], ['Vijay Sales', 'shopping', 1], ['Nykaa', 'personal-care', 1],
      ['Airtel Xstream', 'telecom', 1], ['Jio Recharge', 'telecom', 1], ['BESCOM', 'utilities', 1], ['PVR INOX', 'entertainment', 1], ['Goibibo', 'travel', 1], ['Upstox', 'investing', 1],
      ['Sri Krishna Sweets', 'dining', 0], ['Anand Kirana Store', 'groceries', 0], ['Balaji Medicals', 'health', 0], ['Om Sai Tailors', 'shopping', 0],
    ],
  },
  PK: {
    city: 'KARACHI', cc: 'PK', rows: [
      ['Imtiaz Super Market', 'groceries', 1], ['Chase Up', 'groceries', 1], ['Al-Fatah', 'groceries', 1], ['Kababjees', 'dining', 1], ['OPTP', 'dining', 1],
      ['PSO', 'transport', 1], ['Bykea', 'transport', 1], ['Dawaai', 'health', 1], ['Daraz', 'shopping', 1], ['Khaadi', 'shopping', 1], ['Zong', 'telecom', 1], ['K-Electric', 'utilities', 1], ['SSGC', 'utilities', 1],
      ['Student Biryani', 'dining', 0], ['Karachi Bakery', 'dining', 0], ['Madina Cloth House', 'shopping', 0],
    ],
  },
  ID: {
    city: 'JAKARTA', cc: 'ID', rows: [
      ['Indomaret', 'groceries', 1], ['Alfamart', 'groceries', 1], ['Superindo', 'groceries', 1], ['Kopi Kenangan', 'dining', 1], ['Janji Jiwa', 'dining', 1], ['HokBen', 'dining', 1],
      ['Pertamina', 'transport', 1], ['TransJakarta', 'transport', 1], ['Blue Bird', 'transport', 1], ['Kimia Farma', 'health', 1], ['Halodoc', 'health', 1], ['Tokopedia', 'shopping', 1], ['Blibli', 'shopping', 1],
      ['Telkomsel', 'telecom', 1], ['Indosat', 'telecom', 1], ['PLN Prepaid', 'utilities', 1], ['Cinema XXI', 'entertainment', 1], ['Citilink', 'travel', 1],
      ['Warung Bu Tini', 'dining', 0], ['Toko Sumber Rejeki', 'groceries', 0], ['Bengkel Jaya Motor', 'transport', 0],
    ],
  },
  MY: {
    city: 'KUALA LUMPUR', cc: 'MY', rows: [
      ['Lotus\'s', 'groceries', 1], ['Mydin', 'groceries', 1], ['Jaya Grocer', 'groceries', 1], ['99 Speedmart', 'groceries', 1], ['Tealive', 'dining', 1], ['ZUS Coffee', 'dining', 1], ['Secret Recipe', 'dining', 1],
      ['Petronas', 'transport', 1], ['RapidKL', 'transport', 1], ['Caring Pharmacy', 'health', 1], ['MR DIY', 'shopping', 1], ['Senheng', 'shopping', 1], ['Maxis', 'telecom', 1], ['CelcomDigi', 'telecom', 1], ['Tenaga Nasional', 'utilities', 1], ['GSC', 'entertainment', 1],
      ['Restoran Nasi Kandar Pelita', 'dining', 0], ['Kedai Runcit Ah Seng', 'groceries', 0],
    ],
  },
  SG: {
    city: 'SINGAPORE', cc: 'SG', rows: [
      ['FairPrice', 'groceries', 1], ['Sheng Siong', 'groceries', 1], ['Cold Storage', 'groceries', 1], ['Ya Kun Kaya Toast', 'dining', 1], ['BreadTalk', 'dining', 1], ['Old Chang Kee', 'dining', 1],
      ['SimplyGo', 'transport', 1], ['ComfortDelGro', 'transport', 1], ['Unity Pharmacy', 'health', 1], ['Challenger', 'shopping', 1], ['Qoo10', 'shopping', 1], ['Singtel', 'telecom', 1], ['StarHub', 'telecom', 1], ['SP Services', 'utilities', 1], ['Golden Village', 'entertainment', 1],
      ['Tian Tian Chicken Rice', 'dining', 0], ['Ah Hock Provision Shop', 'groceries', 0],
    ],
  },
  PH: {
    city: 'MAKATI', cc: 'PH', rows: [
      ['Puregold', 'groceries', 1], ['SM Supermarket', 'groceries', 1], ['Robinsons Supermarket', 'groceries', 1], ['Chowking', 'dining', 1], ['Mang Inasal', 'dining', 1], ['Jollibee', 'dining', 1],
      ['Petron', 'transport', 1], ['Angkas', 'transport', 1], ['Mercury Drug', 'health', 1], ['Wilcon Depot', 'shopping', 1], ['Globe Telecom', 'telecom', 1], ['PLDT', 'telecom', 1], ['Meralco', 'utilities', 1], ['Maynilad', 'utilities', 1], ['Cebu Pacific', 'travel', 1],
      ['Aling Nena Sari-Sari', 'groceries', 0], ['Kuya J Restaurant', 'dining', 0],
    ],
  },
  AU: {
    city: 'SYDNEY', cc: 'AU', rows: [
      ['Woolworths', 'groceries', 1], ['Coles', 'groceries', 1], ['Harris Farm', 'groceries', 1], ['Dan Murphy\'s', 'groceries', 1], ['IGA', 'groceries', 1],
      ['Oporto', 'dining', 1], ['Red Rooster', 'dining', 1], ['Grill\'d', 'dining', 1], ['Zambrero', 'dining', 1], ['Ampol', 'transport', 1], ['Linkt', 'transport', 1], ['Opal', 'transport', 1],
      ['Chemist Warehouse', 'health', 1], ['TerryWhite Chemmart', 'health', 1], ['Bunnings', 'shopping', 1], ['Officeworks', 'shopping', 1], ['Myer', 'shopping', 1], ['The Good Guys', 'shopping', 1],
      ['Telstra', 'telecom', 1], ['Aussie Broadband', 'telecom', 1], ['AGL', 'utilities', 1], ['Sydney Water', 'utilities', 1], ['Foxtel', 'entertainment', 1], ['Event Cinemas', 'entertainment', 1], ['Service NSW', 'government', 1],
      ['Bondi Fish Market', 'groceries', 0], ['Pie Face Cafe', 'dining', 0], ['Opal Tower Strata', 'rent', 0],
    ],
  },
  NZ: {
    city: 'AUCKLAND', cc: 'NZ', rows: [
      ['Countdown', 'groceries', 1], ['Pak\'nSave', 'groceries', 1], ['New World', 'groceries', 1], ['Four Square', 'groceries', 1], ['Hell Pizza', 'dining', 1],
      ['Z Energy', 'transport', 1], ['AT HOP', 'transport', 1], ['Unichem', 'health', 1], ['The Warehouse', 'shopping', 1], ['Noel Leeming', 'shopping', 1], ['Mitre 10', 'shopping', 1],
      ['2degrees', 'telecom', 1], ['One NZ', 'telecom', 1], ['Genesis Energy', 'utilities', 1], ['Air NZ', 'travel', 1],
      ['Ponsonby Butcher', 'groceries', 0], ['Kiwi Fish n Chips', 'dining', 0],
    ],
  },
  ZA: {
    city: 'JOHANNESBURG', cc: 'ZA', rows: [
      ['Checkers', 'groceries', 1], ['Pick n Pay', 'groceries', 1], ['Food Lover\'s Market', 'groceries', 1], ['Boxer', 'groceries', 1], ['Ocean Basket', 'dining', 1], ['Debonairs Pizza', 'dining', 1], ['Mugg & Bean', 'dining', 1],
      ['Gautrain', 'transport', 1], ['Dis-Chem', 'health', 1], ['Clicks', 'health', 1], ['Takealot', 'shopping', 1], ['Mr Price', 'shopping', 1], ['Builders Warehouse', 'shopping', 1],
      ['Vodacom', 'telecom', 1], ['Cell C', 'telecom', 1], ['Eskom', 'utilities', 1], ['Ster-Kinekor', 'entertainment', 1], ['FlySafair', 'travel', 1],
      ['Mzansi Spaza Shop', 'groceries', 0], ['Braai Shack', 'dining', 0],
    ],
  },
  NG: {
    city: 'LAGOS', cc: 'NG', rows: [
      ['Justrite', 'groceries', 1], ['Ebeano Supermarket', 'groceries', 1], ['Chicken Republic', 'dining', 1], ['Chowdeck', 'dining', 1], ['Mr Biggs', 'dining', 1],
      ['NNPC', 'transport', 1], ['Bolt', 'transport', 1], ['MedPlus', 'health', 1], ['Jumia', 'shopping', 1], ['Konga', 'shopping', 1], ['Glo', 'telecom', 1], ['Ikeja Electric', 'utilities', 1], ['Air Peace', 'travel', 1], ['GOtv', 'entertainment', 1],
      ['Mama Put Kitchen', 'dining', 0], ['Balogun Fabrics', 'shopping', 0],
    ],
  },
  KE: {
    city: 'NAIROBI', cc: 'KE', rows: [
      ['Naivas', 'groceries', 1], ['Quickmart', 'groceries', 1], ['Java House', 'dining', 1], ['Artcaffe', 'dining', 1], ['Pizza Inn', 'dining', 1],
      ['Rubis', 'transport', 1], ['Goodlife Pharmacy', 'health', 1], ['Kilimall', 'shopping', 1], ['Safaricom', 'telecom', 1], ['Kenya Power', 'utilities', 1], ['Jambojet', 'travel', 1], ['eCitizen', 'government', 1],
      ['Mama Oliech Restaurant', 'dining', 0], ['Wanjiku Mini Market', 'groceries', 0],
    ],
  },
  EG: {
    city: 'CAIRO', cc: 'EG', rows: [
      ['Seoudi', 'groceries', 1], ['Kheir Zaman', 'groceries', 1], ['Hyperone', 'groceries', 1], ['Buffalo Burger', 'dining', 1], ['Cook Door', 'dining', 1],
      ['Swvl', 'transport', 1], ['El Ezaby', 'health', 1], ['Vezeeta', 'health', 1], ['B.Tech', 'shopping', 1], ['Raya Shop', 'shopping', 1], ['Telecom Egypt', 'telecom', 1], ['Air Cairo', 'travel', 1],
      ['Abou Shakra', 'dining', 0], ['El Abd Patisserie', 'dining', 0],
    ],
  },
  MA: {
    city: 'CASABLANCA', cc: 'MA', rows: [
      ['Marjane', 'groceries', 1], ['Label Vie', 'groceries', 1], ['Afriquia', 'transport', 1], ['ONCF', 'transport', 1], ['Electroplanet', 'shopping', 1], ['Kitea', 'shopping', 1],
      ['Maroc Telecom', 'telecom', 1], ['Inwi', 'telecom', 1], ['Lydec', 'utilities', 1],
      ['Cafe Hafa', 'dining', 0], ['Hanout Si Mohamed', 'groceries', 0],
    ],
  },
  ZZ: {
    city: 'ONLINE', cc: '', rows: [
      ['Netflix', 'entertainment', 1], ['Spotify', 'entertainment', 1], ['Crunchyroll', 'entertainment', 1], ['Nintendo eShop', 'entertainment', 1], ['Twitch', 'entertainment', 1], ['Ticketmaster', 'entertainment', 1],
      ['Dropbox', 'software', 1], ['GitHub', 'software', 1], ['Grammarly', 'software', 1], ['1Password', 'software', 1], ['NordVPN', 'software', 1], ['Midjourney', 'software', 1], ['Squarespace', 'software', 1], ['Atlassian', 'software', 1],
      ['Temu', 'shopping', 1], ['AliExpress', 'shopping', 1], ['Etsy', 'shopping', 1], ['Uniqlo', 'shopping', 1], ['Decathlon', 'shopping', 1], ['Lululemon', 'shopping', 1],
      ['Booking.com', 'travel', 1], ['Agoda', 'travel', 1], ['Trip.com', 'travel', 1], ['Ryanair', 'travel', 1], ['Wizz Air', 'travel', 1], ['Klook', 'travel', 1], ['Hertz', 'travel', 1],
      ['Babbel', 'education', 1], ['Skillshare', 'education', 1], ['MasterClass', 'education', 1], ['Save the Children', 'charity', 1], ['Greenpeace', 'charity', 1], ['Coinbase', 'investing', 1], ['Kraken', 'investing', 1],
      ['Wolt', 'dining', 1], ['Glovo', 'dining', 1], ['Five Guys', 'dining', 1], ['Krispy Kreme', 'dining', 1], ['Bolt Food', 'dining', 1],
      ['Kagi Search', 'software', 0], ['Obsidian Sync', 'software', 0], ['Hinge Dating', 'entertainment', 0], ['Blinkist', 'education', 0], ['Wise Payments', 'other', 0], ['Payoneer', 'other', 0], ['Gumroad', 'shopping', 0], ['Ko-fi', 'charity', 0],
      ['Ubiquiti Store', 'shopping', 0], ['Uberall GmbH', 'software', 0], ['Targetti Lighting', 'shopping', 0], ['Shellfish Shack', 'dining', 0], ['Boltons Hardware', 'shopping', 0], ['Grabowski Bakery', 'dining', 0],
    ],
  },
};

// More merchants deliberately absent from the table (real regional chains and
// independents, plus look-alikes of tokens the table knows).
const MORE_UNKNOWN = {
  US: [['Portillos', 'dining'], ['Schnucks', 'groceries'], ['Tops Markets', 'groceries'], ['Holiday Stationstores', 'transport'], ['Goodwill Store', 'shopping'], ['Kwik Trip', 'transport'], ['Menards', 'shopping'], ['Sheetz Bros Plumbing', 'home-services'], ['Uber Law Firm', 'other']],
  CA: [['Freshii', 'dining'], ['Pharmasave', 'health'], ['Canex', 'shopping'], ['Couche-Tard', 'groceries'], ['Metropolitan Dental', 'health']],
  GB: [['Bettys Tea Room', 'dining'], ['Wilko Plumbing', 'home-services'], ['Paperchase', 'shopping'], ['Pets Corner', 'shopping'], ['Target Darts Ltd', 'shopping'], ['Next Door Cafe', 'dining']],
  IE: [['Spar Hill Farm', 'groceries'], ['Eddie Rockets', 'dining'], ['Mr Price Plumbing', 'home-services'], ['Boots and Saddles', 'shopping']],
  FR: [['Boulangerie Kayser', 'dining'], ['Nicolas Feuillatte', 'groceries'], ['Pharmacie Monge', 'health'], ['Totalement Bio', 'groceries'], ['Casino Barriere', 'entertainment'], ['Action Contre la Faim', 'charity']],
  DE: [['Bäckerei Kamps Cafe', 'dining'], ['Netto Sushi Bar', 'dining'], ['Kiosk am Ring', 'groceries'], ['Apotheke am Dom', 'health'], ['Globus Reisen', 'travel'], ['Obi Wan Sushi', 'dining']],
  ES: [['Carniceria Paco', 'groceries'], ['Churreria San Gines', 'dining'], ['Estanco 12', 'shopping'], ['Mango Tree Restaurant', 'dining'], ['Consum Motor', 'transport']],
  IT: [['Salumeria Roscioli', 'groceries'], ['Pasticceria Marchesi', 'dining'], ['Tim Burton Store', 'shopping'], ['Coopervision', 'health'], ['Pam Pam Gelato', 'dining']],
  NL: [['Bakker Bart', 'dining'], ['Plus Min Architecten', 'other'], ['Dirk Jansen Loodgieter', 'home-services'], ['Jumbo Visma Fanshop', 'shopping'], ['Action Sportschool', 'health']],
  BE: [['Maison Dandoy', 'dining'], ['Okay Lunch', 'dining'], ['Match Point Tennis', 'health'], ['Quick Wash Laundry', 'home-services']],
  CH: [['Sprüngli', 'dining'], ['Coop Tennis Club', 'health'], ['Manor Farm Bakery', 'dining'], ['Salt and Pepper Grill', 'dining']],
  PT: [['Manteigaria', 'dining'], ['Nos Alive Festival', 'entertainment'], ['Meo Sushi', 'dining'], ['Continente Tours', 'travel']],
  TR: [['Hafiz Mustafa', 'dining'], ['Bim Kuafor', 'personal-care'], ['Mado Tekstil', 'shopping'], ['Gratis Wifi Cafe', 'dining'], ['Karakoy Gulluoglu', 'dining']],
  BR: [['Extra Fitness', 'health'], ['Vivo Bar', 'dining'], ['Oi Burger', 'dining'], ['Tim Maia Bar', 'dining'], ['Emporio Santa Maria', 'groceries']],
  MX: [['Liverpool Pub', 'dining'], ['Sat Yoga Studio', 'health'], ['Ado Studio', 'other'], ['El Califa', 'dining'], ['Panaderia Rosetta', 'dining']],
  CO: [['Ara Restaurante', 'dining'], ['D1 Motos', 'transport'], ['Exito Gym', 'health'], ['Andres Carne de Res', 'dining'], ['Pan Pa Ya', 'dining']],
  AR: [['Disco Bar Palermo', 'entertainment'], ['Coto Hotel', 'travel'], ['Vea Optica', 'health'], ['Guerrin Pizzeria', 'dining'], ['Personal Trainer Juan', 'health']],
  IN: [['Ola Ola Cafe', 'dining'], ['Apollo Tyres', 'transport'], ['Lifestyle Salon', 'personal-care'], ['Westside Dental', 'health'], ['Saravana Bhavan', 'dining'], ['Nilgiris 1905', 'groceries']],
  PK: [['Jazz Cafe', 'dining'], ['Sapphire Salon', 'personal-care'], ['Outfitters Garage', 'transport'], ['Monal Restaurant', 'dining'], ['Naheed Clinic', 'health']],
  ID: [['Giant Burger Jkt', 'dining'], ['Century Hotel', 'travel'], ['Informa Consulting', 'other'], ['Matahari Dental', 'health'], ['Bakso Pak Kumis', 'dining']],
  MY: [['Giant Bowl Noodle', 'dining'], ['Parkson Cafe', 'dining'], ['Digi Photo Studio', 'shopping'], ['Village Park Nasi Lemak', 'dining'], ['Astro Boy Toys', 'shopping']],
  SG: [['Koi Pond Cafe', 'dining'], ['Cheers Bar', 'dining'], ['Mustafa Tailor', 'shopping'], ['Tangs Dental', 'health'], ['Ryde Bicycle Shop', 'shopping']],
  PH: [['Greenwich Dental', 'health'], ['Smart Tailoring', 'shopping'], ['Globe Travel Agency', 'travel'], ['Goldilocks Salon', 'personal-care'], ['Phoenix Laundry', 'home-services']],
  AU: [['Target Archery Club', 'entertainment'], ['Coles Bay Bakery', 'dining'], ['Opal Dental', 'health'], ['Myer Street Cafe', 'dining'], ['Stan Plumbing', 'home-services']],
  NZ: [['Mercury Bay Motors', 'transport'], ['Spark Arts Studio', 'education'], ['Farmers Market Cafe', 'dining'], ['Sky City Casino', 'entertainment'], ['Skinny Dip Gelato', 'dining']],
  ZA: [['Checkers Car Wash', 'transport'], ['Game Lodge Safari', 'travel'], ['Clicks Photography', 'shopping'], ['Rain Coffee Roasters', 'dining'], ['Pep Guardiola Fan Shop', 'shopping']],
  NG: [['Glo Nails', 'personal-care'], ['Slot Machine Arcade', 'entertainment'], ['Bamboo Lounge', 'dining'], ['Market Square Pharmacy', 'health'], ['Kilimanjaro Tours', 'travel']],
  KE: [['Hotpoint Clinic', 'health'], ['Kra Kra Bistro', 'dining'], ['Carnivore Restaurant', 'dining'], ['Zucchini Grocers', 'groceries']],
  EG: [['Noon Cafe', 'dining'], ['Rabbit Hole Books', 'shopping'], ['Momen Law Office', 'other'], ['Zooba', 'dining'], ['Felfela', 'dining']],
  MA: [['Bim Bap Korean', 'dining'], ['Ram Auto', 'transport'], ['Iam Fitness', 'health'], ['Cafe Clock', 'dining']],
  ZZ: [['Substack', 'entertainment'], ['Readwise', 'software'], ['Raycast', 'software'], ['Mubi', 'entertainment'], ['Kobo Books', 'entertainment'], ['Allegro Poland', 'shopping'], ['Airalo', 'telecom'], ['Holafly', 'telecom']],
};
for (const [country, list] of Object.entries(MORE_UNKNOWN)) {
  for (const [brand, category] of list) B[country].rows.push([brand, category, 0]);
}

// Out-of-table names written ON PURPOSE to contain a token the table knows
// (declared at authoring time, not derived from the table's output).
const LOOKALIKES = new Set([
  'Diamond Dry Cleaners', 'Action Plumbing', 'Tim\'s Hardware', 'Coop Brewing Co', 'Jumbo Car Wash', 'Sheetz Bros Plumbing', 'Uber Law Firm',
  'Target Shooting Range', 'Target Darts Ltd', 'Next Door Cafe', 'Wilko Plumbing', 'Spar Hill Farm', 'Mr Price Plumbing', 'Boots and Saddles',
  'Orangerie du Parc', 'Casino Barriere', 'Action Contre la Faim', 'Totalement Bio', 'Nicolas Feuillatte', 'Mueller Schreinerei', 'Netto Sushi Bar',
  'Globus Reisen', 'Obi Wan Sushi', 'Bäckerei Kamps Cafe', 'Diamante Joyeros', 'Dia Hostal', 'Mango Tree Restaurant', 'Consum Motor', 'Tim Burton Store',
  'Coopervision', 'Pam Pam Gelato', 'Plus Min Architecten', 'Dirk Jansen Loodgieter', 'Jumbo Visma Fanshop', 'Action Sportschool', 'Okay Lunch',
  'Match Point Tennis', 'Quick Wash Laundry', 'Coop Tennis Club', 'Manor Farm Bakery', 'Salt and Pepper Grill', 'Nos Alive Festival', 'Meo Sushi',
  'Continente Tours', 'Bim Kuaför', 'Bim Kuafor', 'Mado Tekstil', 'Gratis Wifi Cafe', 'Extra Fitness', 'Vivo Bar', 'Oi Burger', 'Tim Maia Bar',
  'Liverpool Pub', 'Sat Yoga Studio', 'Ado Studio', 'Ara Restaurante', 'D1 Motos', 'Exito Gym', 'Disco Bar Palermo', 'Coto Hotel', 'Vea Optica',
  'Personal Trainer Juan', 'Ola Ola Cafe', 'Apollo Tyres', 'Lifestyle Salon', 'Westside Dental', 'Jazz Cafe', 'Sapphire Salon', 'Outfitters Garage',
  'Naheed Clinic', 'Giant Burger Jkt', 'Century Hotel', 'Informa Consulting', 'Matahari Dental', 'Giant Bowl Noodle', 'Parkson Cafe', 'Digi Photo Studio',
  'Astro Boy Toys', 'Koi Pond Cafe', 'Cheers Bar', 'Mustafa Tailor', 'Tangs Dental', 'Ryde Bicycle Shop', 'Greenwich Dental', 'Smart Tailoring',
  'Globe Travel Agency', 'Goldilocks Salon', 'Phoenix Laundry', 'Target Archery Club', 'Coles Bay Bakery', 'Opal Dental', 'Myer Street Cafe',
  'Stan Plumbing', 'Opal Tower Strata', 'Mercury Bay Motors', 'Spark Arts Studio', 'Farmers Market Cafe', 'Sky City Casino', 'Skinny Dip Gelato',
  'Checkers Car Wash', 'Game Lodge Safari', 'Clicks Photography', 'Rain Coffee Roasters', 'Pep Guardiola Fan Shop', 'Glo Nails', 'Slot Machine Arcade',
  'Bamboo Lounge', 'Market Square Pharmacy', 'Kilimanjaro Tours', 'Hotpoint Clinic', 'Kra Kra Bistro', 'Noon Cafe', 'Rabbit Hole Books',
  'Momen Law Office', 'Bim Bap Korean', 'Ram Auto', 'Iam Fitness', 'Ubiquiti Store', 'Uberall GmbH', 'Targetti Lighting', 'Shellfish Shack',
  'Boltons Hardware', 'Grabowski Bakery', 'Orange County Choppers',
]);

// Deterministic noise.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const digits = (seed, n) => String(seed % 10 ** n).padStart(n, '0');
const TEMPLATES = [
  (b, c, h) => `${b.toUpperCase()} #${digits(h, 4)}`,
  (b, c, h) => `POS ${digits(h >>> 3, 4)} ${b.toUpperCase()} ${c.city} ${c.cc}`.trim(),
  (b, c, h) => `SQ *${b.toUpperCase()}`,
  (b, c) => `${b.toUpperCase()} ${c.city}`.slice(0, 22).trim(),
  (b, c, h) => `PAYPAL *${b.toUpperCase().replace(/[\s']+/g, '')} ${digits(h, 10)}`,
  (b, c) => `${b.toLowerCase()} ${c.city.toLowerCase()}`,
  (b, c, h) => `${b.toUpperCase()}*${(h % 36 ** 6).toString(36).toUpperCase()}`,
  (b, c, h) => `${b.toUpperCase()} ${digits(h >>> 5, 6)} ${c.cc}`.trim(),
  (b, c, h) => `CRV*${b.toUpperCase()} ${c.city}`.slice(0, 26),
  (b, c) => `${b}`,
];

const DESCRIPTORS = Object.entries(B).flatMap(([country, conf]) => conf.rows.map(([brand, category, inTable], i) => {
  const h = hash(`${country}:${brand}`);
  const template = TEMPLATES[(h + i) % TEMPLATES.length];
  return { country, brand, category, inTable: Boolean(inTable), lookalike: !inTable && LOOKALIKES.has(brand), descriptor: template(brand, conf, h) };
}));

module.exports = { DESCRIPTORS };
