'use strict';
/**
 * Labelled merchant descriptors for category evaluation, written from public
 * knowledge of what each chain/brand sells (plus generic descriptive names).
 * Descriptors imitate card-statement spellings (store numbers, processor
 * prefixes, city suffixes). Categories use the app's ids (src/lib/categories.ts).
 * `group` is the brand, so a held-out split never shares a brand with training.
 */
const M = {
  US: [
    ['WALMART SUPERCENTER #2291', 'groceries'], ['TRADER JOE S #552', 'groceries'], ['WHOLEFDS MKT 10233', 'groceries'], ['KROGER #0412', 'groceries'], ['SAFEWAY 1123', 'groceries'], ['PUBLIX SUPER MARKETS', 'groceries'], ['ALDI 64012', 'groceries'],
    ['STARBUCKS STORE 10321', 'dining'], ['SQ *BLUE BOTTLE COFFEE', 'dining'], ['MCDONALD\'S F12345', 'dining'], ['CHIPOTLE 1842', 'dining'], ['DOORDASH*CHIPOTLE', 'dining'], ['UBER *EATS PENDING', 'dining'], ['TST* JOES PIZZERIA', 'dining'], ['DUNKIN #350112', 'dining'], ['PANERA BREAD #601', 'dining'],
    ['UBER *TRIP', 'transport'], ['LYFT *RIDE SUN 4PM', 'transport'], ['SHELL OIL 57442', 'transport'], ['CHEVRON 0091234', 'transport'], ['EXXONMOBIL 4410', 'transport'], ['MTA*NYCT PAYGO', 'transport'], ['PARKMOBILE', 'transport'],
    ['CVS/PHARMACY #0921', 'health'], ['WALGREENS #1432', 'health'], ['KAISER PERMANENTE', 'health'], ['QUEST DIAGNOSTICS', 'health'],
    ['AMAZON.COM*2K4TR', 'shopping'], ['TARGET 00012345', 'shopping'], ['HOME DEPOT #4410', 'shopping'], ['BEST BUY 00012', 'shopping'], ['IKEA BROOKLYN', 'shopping'], ['NIKE.COM', 'shopping'], ['MACYS .COM', 'shopping'],
    ['NETFLIX.COM', 'entertainment'], ['SPOTIFY USA', 'entertainment'], ['AMC THEATRES 1234', 'entertainment'], ['STEAMGAMES.COM 4259522', 'entertainment'], ['HULU 877-8244858', 'entertainment'],
    ['DELTA AIR 0062', 'travel'], ['UNITED 0162', 'travel'], ['MARRIOTT HOTELS', 'travel'], ['AIRBNB * HMXYZ', 'travel'], ['EXPEDIA 72619', 'travel'],
    ['VERIZON WRLS P2P', 'telecom'], ['T-MOBILE AUTOPAY', 'telecom'], ['COMCAST XFINITY', 'telecom'],
    ['CON ED OF NY', 'utilities'], ['PG&E WEB ONLINE', 'utilities'], ['DUKE ENERGY', 'utilities'],
    ['GITHUB INC', 'software'], ['OPENAI *CHATGPT SUBSCR', 'software'], ['ADOBE *CREATIVE CLD', 'software'], ['DROPBOX*JZ41', 'software'],
    ['GREAT CLIPS #8830', 'personal-care'], ['ULTA BEAUTY 0441', 'personal-care'],
    ['COURSERA', 'education'], ['UNIV OF MICHIGAN TUITION', 'education'],
    ['IRS USATAXPYMT', 'government'], ['DMV CA RENEWAL', 'government'],
    ['RED CROSS DONATION', 'charity'], ['ROBINHOOD SECURITIES', 'investing'],
  ],
  GB: [
    ['TESCO STORES 3345', 'groceries'], ['SAINSBURYS S/MKTS', 'groceries'], ['WAITROSE 612', 'groceries'], ['ASDA SUPERSTORE', 'groceries'], ['MORRISONS 0231', 'groceries'], ['LIDL GB LONDON', 'groceries'], ['OCADO RETAIL', 'groceries'],
    ['PRET A MANGER', 'dining'], ['COSTA COFFEE 43002', 'dining'], ['GREGGS PLC', 'dining'], ['NANDOS CAMDEN', 'dining'], ['DELIVEROO', 'dining'], ['JUST EAT.CO.UK LTD', 'dining'], ['WAGAMAMA LTD', 'dining'],
    ['TFL TRAVEL CH', 'transport'], ['TRAINLINE', 'transport'], ['BP OIL UK', 'transport'], ['NCP PARKING', 'transport'],
    ['BOOTS 1123', 'health'], ['SUPERDRUG STORES', 'health'], ['BUPA CENTRE', 'health'],
    ['ARGOS LTD', 'shopping'], ['AMAZON UK MARKETPLACE', 'shopping'], ['PRIMARK LONDON', 'shopping'], ['JOHN LEWIS', 'shopping'], ['CURRYS PC WORLD', 'shopping'], ['B&Q 1182', 'shopping'],
    ['BRITISH AIRWAYS', 'travel'], ['EASYJET', 'travel'], ['PREMIER INN', 'travel'],
    ['EE LIMITED', 'telecom'], ['VODAFONE UK', 'telecom'], ['BT GROUP PLC', 'telecom'],
    ['BRITISH GAS', 'utilities'], ['THAMES WATER', 'utilities'], ['OCTOPUS ENERGY', 'utilities'],
    ['COUNCIL TAX CAMDEN', 'government'], ['DVLA VEHICLE TAX', 'government'], ['HMRC SELF ASSESSMENT', 'government'],
    ['ODEON CINEMAS', 'entertainment'], ['SKY DIGITAL', 'entertainment'],
    ['OXFAM GB', 'charity'], ['VANGUARD ASSET MGMT', 'investing'], ['TONI&GUY', 'personal-care'],
  ],
  CA: [
    ['LOBLAWS #1123', 'groceries'], ['METRO 211', 'groceries'], ['SOBEYS #822', 'groceries'], ['NO FRILLS 3321', 'groceries'],
    ['TIM HORTONS #3321', 'dining'], ['A&W RESTAURANT', 'dining'], ['SKIPTHEDISHES', 'dining'],
    ['PETRO-CANADA 88', 'transport'], ['PRESTO FARE', 'transport'], ['ESSO CIRCLE K', 'transport'],
    ['SHOPPERS DRUG MART', 'health'], ['REXALL PHARMACY', 'health'],
    ['CANADIAN TIRE #045', 'shopping'], ['AMZN MKTP CA', 'shopping'], ['WINNERS 211', 'shopping'], ['HUDSONS BAY', 'shopping'],
    ['AIR CANADA', 'travel'], ['WESTJET', 'travel'], ['ROGERS WIRELESS', 'telecom'], ['BELL CANADA', 'telecom'],
    ['HYDRO ONE', 'utilities'], ['ENBRIDGE GAS', 'utilities'], ['CINEPLEX 7731', 'entertainment'], ['SAQ 23011', 'groceries'],
    ['SERVICE ONTARIO', 'government'], ['WEALTHSIMPLE', 'investing'],
  ],
  AU: [
    ['WOOLWORTHS 1204', 'groceries'], ['COLES 0761', 'groceries'], ['IGA NEWTOWN', 'groceries'], ['ALDI STORES AU', 'groceries'],
    ['GUZMAN Y GOMEZ', 'dining'], ['HUNGRY JACKS', 'dining'], ['MENULOG', 'dining'], ['BOOST JUICE', 'dining'],
    ['MYKI TOPUP', 'transport'], ['OPAL TRANSPORT NSW', 'transport'], ['AMPOL 2210', 'transport'], ['LINKT TOLL', 'transport'],
    ['CHEMIST WAREHOUSE', 'health'], ['PRICELINE PHARMACY', 'health'], ['JB HI-FI', 'shopping'], ['BUNNINGS 4402', 'shopping'], ['KMART AUSTRALIA', 'shopping'], ['BIG W', 'shopping'],
    ['QANTAS AIRWAYS', 'travel'], ['VIRGIN AUSTRALIA', 'travel'], ['TELSTRA', 'telecom'], ['OPTUS BILLING', 'telecom'],
    ['AGL ENERGY', 'utilities'], ['ORIGIN ENERGY', 'utilities'], ['BWS LIQUOR', 'groceries'], ['STAN.COM.AU', 'entertainment'],
  ],
  IN: [
    ['BIGBASKET', 'groceries'], ['DMART', 'groceries'], ['RELIANCE FRESH', 'groceries'], ['BLINKIT', 'groceries'], ['ZEPTO MARKETPLACE', 'groceries'], ['MORE RETAIL', 'groceries'], ['NATURES BASKET', 'groceries'],
    ['SWIGGY', 'dining'], ['ZOMATO', 'dining'], ['DOMINOS PIZZA INDIA', 'dining'], ['HALDIRAMS', 'dining'], ['CAFE COFFEE DAY', 'dining'], ['CHAAYOS', 'dining'],
    ['OLA CABS', 'transport'], ['UBER INDIA', 'transport'], ['RAPIDO', 'transport'], ['INDIAN OIL', 'transport'], ['HPCL PETROL PUMP', 'transport'], ['FASTAG NHAI', 'transport'], ['DELHI METRO RAIL', 'transport'],
    ['APOLLO PHARMACY', 'health'], ['PHARMEASY', 'health'], ['1MG TECHNOLOGIES', 'health'], ['FORTIS HOSPITAL', 'health'],
    ['FLIPKART', 'shopping'], ['AMAZON PAY INDIA', 'shopping'], ['MYNTRA', 'shopping'], ['CROMA', 'shopping'], ['NYKAA', 'personal-care'],
    ['IRCTC', 'travel'], ['MAKEMYTRIP', 'travel'], ['INDIGO AIRLINES', 'travel'], ['OYO ROOMS', 'travel'],
    ['AIRTEL PAYMENTS', 'telecom'], ['JIO PREPAID RECHARGE', 'telecom'], ['VI POSTPAID', 'telecom'],
    ['BESCOM', 'utilities'], ['TATA POWER', 'utilities'], ['MAHANAGAR GAS', 'utilities'],
    ['BOOKMYSHOW', 'entertainment'], ['HOTSTAR', 'entertainment'], ['BYJUS', 'education'], ['UNACADEMY', 'education'],
    ['ZERODHA BROKING', 'investing'], ['GROWW', 'investing'], ['LIC PREMIUM', 'other'], ['URBAN COMPANY', 'home-services'],
  ],
  AE: [
    ['CARREFOUR MOE', 'groceries'], ['LULU HYPERMARKET', 'groceries'], ['SPINNEYS', 'groceries'], ['WAITROSE DUBAI MALL', 'groceries'], ['UNION COOP', 'groceries'], ['CHOITHRAMS', 'groceries'], ['KIBSONS', 'groceries'],
    ['TALABAT', 'dining'], ['CAREEM FOOD', 'dining'], ['DELIVEROO AE', 'dining'], ['TIM HORTONS DXB', 'dining'], ['SHAKE SHACK DUBAI', 'dining'], ['ARABIAN TEA HOUSE', 'dining'],
    ['CAREEM RIDE', 'transport'], ['ENOC 1021', 'transport'], ['ADNOC 440', 'transport'], ['RTA NOL TOPUP', 'transport'], ['SALIK', 'transport'], ['EMARAT 212', 'transport'],
    ['BOOTS PHARMACY', 'health'], ['LIFE PHARMACY', 'health'], ['ASTER CLINIC', 'health'], ['MEDICLINIC', 'health'],
    ['NOON.COM', 'shopping'], ['AMAZON.AE', 'shopping'], ['SHARAF DG', 'shopping'], ['IKEA DUBAI', 'shopping'], ['CENTREPOINT', 'shopping'], ['ACE HARDWARE', 'shopping'],
    ['EMIRATES AIRLINE', 'travel'], ['FLYDUBAI', 'travel'], ['ETIHAD AIRWAYS', 'travel'], ['BOOKING.COM', 'travel'],
    ['ETISALAT', 'telecom'], ['DU TELECOM', 'telecom'], ['DEWA', 'utilities'], ['ADDC', 'utilities'], ['EMPOWER', 'utilities'],
    ['VOX CINEMAS', 'entertainment'], ['REEL CINEMAS', 'entertainment'], ['DUBAI POLICE FINES', 'government'], ['AMER CENTRE', 'government'],
    ['JUSTLIFE HOME SERVICES', 'home-services'], ['TIPS & TOES', 'personal-care'], ['GEMS EDUCATION', 'education'],
  ],
  SA: [
    ['PANDA RETAIL', 'groceries'], ['TAMIMI MARKETS', 'groceries'], ['DANUBE', 'groceries'], ['OTHAIM MARKETS', 'groceries'], ['CARREFOUR KSA', 'groceries'],
    ['HUNGERSTATION', 'dining'], ['JAHEZ', 'dining'], ['ALBAIK', 'dining'], ['KUDU', 'dining'], ['BARNS CAFE', 'dining'],
    ['ALDREES', 'transport'], ['SASCO', 'transport'], ['UBER KSA', 'transport'], ['NAHDI PHARMACY', 'health'], ['AL DAWAA', 'health'],
    ['JARIR BOOKSTORE', 'shopping'], ['EXTRA STORES', 'shopping'], ['NAMSHI', 'shopping'], ['SAUDIA AIRLINES', 'travel'], ['FLYNAS', 'travel'],
    ['STC', 'telecom'], ['MOBILY', 'telecom'], ['SEC ELECTRICITY', 'utilities'], ['NWC WATER', 'utilities'], ['ABSHER', 'government'], ['MUVI CINEMAS', 'entertainment'],
  ],
  EG: [
    ['SEOUDI MARKET', 'groceries'], ['CARREFOUR MAADI', 'groceries'], ['METRO MARKETS EG', 'groceries'], ['KHEIR ZAMAN', 'groceries'],
    ['TALABAT EG', 'dining'], ['ELMENUS', 'dining'], ['KOSHARY ABOU TAREK', 'dining'], ['EL EZABY PHARMACY', 'health'], ['SEIF PHARMACY', 'health'],
    ['B.TECH', 'shopping'], ['JUMIA EG', 'shopping'], ['UBER EG', 'transport'], ['CAREEM EG', 'transport'], ['WE TELECOM EGYPT', 'telecom'], ['VODAFONE EG', 'telecom'], ['EGYPTAIR', 'travel'],
  ],
  FR: [
    ['CARREFOUR CITY', 'groceries'], ['MONOPRIX PARIS 11', 'groceries'], ['LECLERC', 'groceries'], ['FRANPRIX 5521', 'groceries'], ['INTERMARCHE', 'groceries'], ['PICARD SURGELES', 'groceries'], ['AUCHAN', 'groceries'],
    ['BOULANGERIE PAUL', 'dining'], ['UBER EATS FR', 'dining'], ['BRASSERIE LIPP', 'dining'], ['MCDO PARIS', 'dining'], ['CAFE DE FLORE', 'dining'],
    ['SNCF INTERNET', 'transport'], ['RATP NAVIGO', 'transport'], ['TOTALENERGIES', 'transport'], ['BLABLACAR', 'transport'], ['VINCI AUTOROUTES', 'transport'],
    ['PHARMACIE DU CENTRE', 'health'], ['DOCTOLIB', 'health'], ['FNAC', 'shopping'], ['DECATHLON', 'shopping'], ['LEROY MERLIN', 'shopping'], ['DARTY', 'shopping'], ['ZALANDO', 'shopping'],
    ['AIR FRANCE', 'travel'], ['ORANGE SA', 'telecom'], ['SFR', 'telecom'], ['EDF CLIENTS', 'utilities'], ['ENGIE', 'utilities'], ['CANAL+', 'entertainment'], ['UGC CINE CITE', 'entertainment'],
    ['SEPHORA', 'personal-care'], ['IMPOTS.GOUV', 'government'], ['DGFIP AMENDE', 'government'],
  ],
  DE: [
    ['REWE MARKT GMBH', 'groceries'], ['EDEKA CENTER', 'groceries'], ['LIDL DIENSTL', 'groceries'], ['ALDI SUED', 'groceries'], ['NETTO MARKEN-DISCOUNT', 'groceries'], ['KAUFLAND', 'groceries'], ['PENNY MARKT', 'groceries'],
    ['LIEFERANDO', 'dining'], ['BACKWERK', 'dining'], ['VAPIANO', 'dining'], ['BURGER KING DE', 'dining'],
    ['DB VERTRIEB GMBH', 'transport'], ['BVG BERLIN', 'transport'], ['SHELL DEUTSCHLAND', 'transport'], ['ARAL STATION', 'transport'], ['FLIXBUS', 'transport'],
    ['DM DROGERIE MARKT', 'personal-care'], ['ROSSMANN', 'personal-care'], ['APOTHEKE AM MARKT', 'health'], ['DOCMORRIS', 'health'],
    ['MEDIA MARKT', 'shopping'], ['SATURN', 'shopping'], ['OTTO GMBH', 'shopping'], ['IKEA DEUTSCHLAND', 'shopping'], ['OBI BAUMARKT', 'shopping'],
    ['LUFTHANSA', 'travel'], ['TELEKOM DEUTSCHLAND', 'telecom'], ['O2 GERMANY', 'telecom'], ['STADTWERKE MUENCHEN', 'utilities'], ['E.ON ENERGIE', 'utilities'],
    ['RUNDFUNK ARD ZDF', 'government'], ['CINEMAXX', 'entertainment'], ['TRADE REPUBLIC', 'investing'],
  ],
  ES: [
    ['MERCADONA', 'groceries'], ['CARREFOUR EXPRESS', 'groceries'], ['DIA', 'groceries'], ['EROSKI', 'groceries'], ['ALCAMPO', 'groceries'], ['CONSUM', 'groceries'],
    ['GLOVO', 'dining'], ['TELEPIZZA', 'dining'], ['100 MONTADITOS', 'dining'], ['JUST EAT ES', 'dining'], ['RESTAURANTE CASA PACO', 'dining'],
    ['RENFE VIAJEROS', 'transport'], ['REPSOL', 'transport'], ['CABIFY', 'transport'], ['METRO DE MADRID', 'transport'], ['CEPSA', 'transport'],
    ['FARMACIA LOPEZ', 'health'], ['SANITAS', 'health'], ['EL CORTE INGLES', 'shopping'], ['ZARA', 'shopping'], ['PRIMOR', 'personal-care'], ['MEDIA MARKT ES', 'shopping'],
    ['IBERIA', 'travel'], ['VUELING', 'travel'], ['MOVISTAR', 'telecom'], ['IBERDROLA', 'utilities'], ['NATURGY', 'utilities'], ['AGENCIA TRIBUTARIA', 'government'],
  ],
  MX: [
    ['OXXO', 'groceries'], ['SORIANA', 'groceries'], ['CHEDRAUI', 'groceries'], ['LA COMER', 'groceries'], ['BODEGA AURRERA', 'groceries'],
    ['RAPPI', 'dining'], ['DIDI FOOD', 'dining'], ['VIPS', 'dining'], ['TAQUERIA EL PASTOR', 'dining'], ['PEMEX', 'transport'], ['DIDI MOBILITY', 'transport'],
    ['FARMACIAS GUADALAJARA', 'health'], ['FARMACIAS DEL AHORRO', 'health'], ['LIVERPOOL', 'shopping'], ['COPPEL', 'shopping'], ['MERCADO LIBRE MX', 'shopping'],
    ['AEROMEXICO', 'travel'], ['VOLARIS', 'travel'], ['TELCEL', 'telecom'], ['TELMEX', 'telecom'], ['CFE SUMINISTRADOR', 'utilities'], ['CINEPOLIS', 'entertainment'], ['SAT PAGO IMPUESTOS', 'government'],
  ],
  BR: [
    ['PAO DE ACUCAR', 'groceries'], ['CARREFOUR BR', 'groceries'], ['ASSAI ATACADISTA', 'groceries'], ['ATACADAO', 'groceries'], ['HORTIFRUTI', 'groceries'],
    ['IFOOD', 'dining'], ['PADARIA REAL', 'dining'], ['OUTBACK STEAKHOUSE', 'dining'], ['HABIBS', 'dining'],
    ['UBER BR', 'transport'], ['99 TAXI', 'transport'], ['POSTO IPIRANGA', 'transport'], ['SHELL SELECT BR', 'transport'], ['SEM PARAR', 'transport'],
    ['DROGASIL', 'health'], ['DROGA RAIA', 'health'], ['MERCADOLIVRE', 'shopping'], ['MAGAZINE LUIZA', 'shopping'], ['AMERICANAS', 'shopping'], ['RENNER', 'shopping'],
    ['LATAM AIRLINES', 'travel'], ['GOL LINHAS', 'travel'], ['VIVO', 'telecom'], ['CLARO BR', 'telecom'], ['ENEL SP', 'utilities'], ['SABESP', 'utilities'], ['GLOBOPLAY', 'entertainment'], ['BOTICARIO', 'personal-care'],
  ],
  IT: [
    ['ESSELUNGA', 'groceries'], ['COOP ITALIA', 'groceries'], ['CONAD', 'groceries'], ['CARREFOUR MARKET IT', 'groceries'], ['PAM PANORAMA', 'groceries'],
    ['JUST EAT IT', 'dining'], ['AUTOGRILL', 'dining'], ['PIZZERIA DA MICHELE', 'dining'], ['BAR CENTRALE', 'dining'],
    ['TRENITALIA', 'transport'], ['ITALO TRENO', 'transport'], ['ENI STATION', 'transport'], ['ATM MILANO', 'transport'], ['AUTOSTRADE PER L ITALIA', 'transport'],
    ['FARMACIA COMUNALE', 'health'], ['UNIEURO', 'shopping'], ['MEDIAWORLD', 'shopping'], ['OVS', 'shopping'], ['ITA AIRWAYS', 'travel'],
    ['TIM', 'telecom'], ['WINDTRE', 'telecom'], ['ENEL ENERGIA', 'utilities'], ['HERA COMM', 'utilities'], ['AGENZIA ENTRATE', 'government'],
  ],
  NL: [
    ['ALBERT HEIJN 1432', 'groceries'], ['JUMBO', 'groceries'], ['PLUS SUPERMARKT', 'groceries'], ['DIRK VD BROEK', 'groceries'], ['PICNIC', 'groceries'],
    ['THUISBEZORGD', 'dining'], ['FEBO', 'dining'], ['NS GROEP', 'transport'], ['GVB AMSTERDAM', 'transport'], ['TINQ TANKSTATION', 'transport'],
    ['KRUIDVAT', 'personal-care'], ['ETOS', 'personal-care'], ['APOTHEEK ZUID', 'health'], ['HEMA', 'shopping'], ['BOL.COM', 'shopping'], ['COOLBLUE', 'shopping'], ['ACTION', 'shopping'], ['GAMMA BOUWMARKT', 'shopping'],
    ['KLM', 'travel'], ['KPN', 'telecom'], ['ZIGGO', 'telecom'], ['VATTENFALL', 'utilities'], ['ENECO', 'utilities'], ['BELASTINGDIENST', 'government'], ['PATHE BIOSCOPEN', 'entertainment'],
  ],
  TR: [
    ['MIGROS', 'groceries'], ['BIM', 'groceries'], ['A101', 'groceries'], ['SOK MARKET', 'groceries'], ['CARREFOURSA', 'groceries'], ['GETIR', 'groceries'],
    ['YEMEKSEPETI', 'dining'], ['SIMIT SARAYI', 'dining'], ['KOFTECI YUSUF', 'dining'], ['OPET', 'transport'], ['SHELL TURKIYE', 'transport'], ['ISTANBULKART', 'transport'], ['BITAKSI', 'transport'],
    ['ECZANE MERKEZ', 'health'], ['TRENDYOL', 'shopping'], ['HEPSIBURADA', 'shopping'], ['LC WAIKIKI', 'shopping'], ['TEKNOSA', 'shopping'], ['KOCTAS', 'shopping'],
    ['THY TURK HAVA YOLLARI', 'travel'], ['PEGASUS', 'travel'], ['TURKCELL', 'telecom'], ['TURK TELEKOM', 'telecom'], ['ENERJISA', 'utilities'], ['IGDAS', 'utilities'], ['GRATIS', 'personal-care'],
  ],
  ID: [
    ['INDOMARET', 'groceries'], ['ALFAMART', 'groceries'], ['SUPERINDO', 'groceries'], ['HYPERMART', 'groceries'], ['LOTTE MART', 'groceries'],
    ['GOFOOD', 'dining'], ['GRABFOOD ID', 'dining'], ['KOPI KENANGAN', 'dining'], ['JANJI JIWA', 'dining'], ['WARUNG PADANG SEDERHANA', 'dining'],
    ['GOJEK GORIDE', 'transport'], ['GRAB ID', 'transport'], ['PERTAMINA', 'transport'], ['KAI COMMUTER', 'transport'], ['JASA MARGA TOL', 'transport'],
    ['KIMIA FARMA', 'health'], ['APOTEK K24', 'health'], ['HALODOC', 'health'], ['TOKOPEDIA', 'shopping'], ['SHOPEE ID', 'shopping'], ['LAZADA ID', 'shopping'], ['ACE HARDWARE ID', 'shopping'],
    ['GARUDA INDONESIA', 'travel'], ['TRAVELOKA', 'travel'], ['TELKOMSEL', 'telecom'], ['INDIHOME', 'telecom'], ['PLN PREPAID', 'utilities'], ['PDAM JAYA', 'utilities'], ['BPJS KESEHATAN', 'health'], ['CGV CINEMAS', 'entertainment'],
  ],
  NG: [
    ['SHOPRITE LEKKI', 'groceries'], ['SPAR NIGERIA', 'groceries'], ['JUSTRITE', 'groceries'], ['CHICKEN REPUBLIC', 'dining'], ['DOMINOS NG', 'dining'], ['CHOWDECK', 'dining'],
    ['BOLT NG', 'transport'], ['TOTAL ENERGIES NG', 'transport'], ['NNPC RETAIL', 'transport'], ['JUMIA', 'shopping'], ['KONGA', 'shopping'], ['MEDPLUS PHARMACY', 'health'],
    ['MTN AIRTIME', 'telecom'], ['AIRTEL NG', 'telecom'], ['IKEDC PREPAID', 'utilities'], ['DSTV', 'entertainment'], ['AIR PEACE', 'travel'],
  ],
  KE: [
    ['NAIVAS SUPERMARKET', 'groceries'], ['QUICKMART', 'groceries'], ['CARREFOUR TRM', 'groceries'], ['JAVA HOUSE', 'dining'], ['ARTCAFFE', 'dining'], ['KFC KENYA', 'dining'],
    ['UBER KENYA', 'transport'], ['RUBIS ENERGY', 'transport'], ['KPLC PREPAID', 'utilities'], ['NAIROBI WATER', 'utilities'], ['SAFARICOM DATA BUNDLES', 'telecom'], ['GOODLIFE PHARMACY', 'health'], ['JUMIA KE', 'shopping'], ['KENYA AIRWAYS', 'travel'], ['SHOWMAX', 'entertainment'],
  ],
  ZA: [
    ['CHECKERS HYPER', 'groceries'], ['WOOLWORTHS FOOD', 'groceries'], ['PICK N PAY', 'groceries'], ['SPAR SA', 'groceries'], ['SHOPRITE SA', 'groceries'],
    ['NANDOS SA', 'dining'], ['MR D FOOD', 'dining'], ['STEERS', 'dining'], ['ENGEN GARAGE', 'transport'], ['SASOL', 'transport'], ['GAUTRAIN', 'transport'], ['UBER SA', 'transport'],
    ['CLICKS', 'health'], ['DIS-CHEM', 'health'], ['TAKEALOT', 'shopping'], ['MAKRO', 'shopping'], ['MR PRICE', 'shopping'], ['VODACOM', 'telecom'], ['MTN SA', 'telecom'], ['CITY POWER JHB', 'utilities'], ['FLYSAFAIR', 'travel'], ['SHOWMAX SA', 'entertainment'],
  ],
  SG: [
    ['NTUC FAIRPRICE', 'groceries'], ['COLD STORAGE', 'groceries'], ['SHENG SIONG', 'groceries'], ['GIANT SG', 'groceries'], ['GRAB*FOOD', 'dining'], ['KOPITIAM', 'dining'], ['YA KUN KAYA TOAST', 'dining'], ['TOAST BOX', 'dining'],
    ['BUS/MRT 21734', 'transport'], ['GRAB*RIDES', 'transport'], ['SPC SERVICE STATION', 'transport'], ['GUARDIAN HEALTH', 'health'], ['WATSONS SG', 'personal-care'], ['SHOPEE SINGAPORE', 'shopping'], ['UNIQLO ION', 'shopping'], ['COURTS', 'shopping'],
    ['SINGAPORE AIRLINES', 'travel'], ['SINGTEL', 'telecom'], ['STARHUB', 'telecom'], ['SP SERVICES', 'utilities'], ['GOLDEN VILLAGE', 'entertainment'], ['IRAS TAX', 'government'],
  ],
  GENERIC: [
    ['PAYPAL *STEAM GAMES', 'entertainment'], ['APPLE.COM/BILL', 'software'], ['GOOGLE *YOUTUBEPREMIUM', 'entertainment'], ['GOOGLE *GOOGLE STORAGE', 'software'], ['MICROSOFT*365 PERSONAL', 'software'], ['NOTION LABS', 'software'], ['CANVA* 104837', 'software'], ['ZOOM.US 888-799-9666', 'software'], ['SLACK T12345', 'software'], ['FIGMA', 'software'], ['JETBRAINS', 'software'], ['CLAUDE.AI SUBSCRIPTION', 'software'], ['CURSOR AI', 'software'], ['1PASSWORD', 'software'],
    ['DISNEY PLUS', 'entertainment'], ['YOUTUBE PREMIUM', 'entertainment'], ['PLAYSTATION NETWORK', 'entertainment'], ['XBOX LIVE', 'entertainment'], ['AUDIBLE', 'entertainment'], ['APPLE MUSIC', 'entertainment'],
    ['UDEMY', 'education'], ['DUOLINGO', 'education'], ['KHAN ACADEMY DONATION', 'charity'], ['UNICEF', 'charity'], ['WIKIMEDIA FOUNDATION', 'charity'],
    ['AGODA', 'travel'], ['HOTELS.COM', 'travel'], ['EMIRATES SKYWARDS', 'travel'], ['HILTON HOTELS', 'travel'], ['IHG HOTELS', 'travel'],
    ['SHEIN', 'shopping'], ['ALIEXPRESS', 'shopping'], ['TEMU', 'shopping'], ['H&M', 'shopping'], ['UNIQLO', 'shopping'], ['APPLE STORE', 'shopping'], ['SAMSUNG STORE', 'shopping'],
    ['CITY DENTAL CLINIC', 'health'], ['GREEN VALLEY HOSPITAL', 'health'], ['SUNRISE MEDICAL CENTRE', 'health'], ['OPTICAL WORLD', 'health'],
    ['HAIR STUDIO 21', 'personal-care'], ['GENTS BARBER SHOP', 'personal-care'], ['LUXE NAIL SPA', 'personal-care'],
    ['SPARKLE CLEANING SERVICES', 'home-services'], ['QUICKFIX PLUMBING', 'home-services'], ['PEST CONTROL CO', 'home-services'], ['LAUNDRY EXPRESS', 'home-services'],
    ['GOLDEN DRAGON RESTAURANT', 'dining'], ['CORNER BAKERY', 'dining'], ['BURGER JOINT 88', 'dining'], ['SUSHI YA', 'dining'],
    ['FRESH MART SUPERMARKET', 'groceries'], ['DAILY NEEDS GROCERY', 'groceries'], ['CITY BUTCHERY', 'groceries'], ['ORGANIC FARM SHOP', 'groceries'],
    ['CITY PARKING AUTHORITY', 'transport'], ['QUICK LUBE AUTO SERVICE', 'transport'], ['CAR WASH EXPRESS', 'transport'], ['TOLL ROAD OPERATOR', 'transport'],
    ['MUNICIPALITY FEES', 'government'], ['PASSPORT OFFICE', 'government'], ['TRAFFIC FINE PAYMENT', 'government'],
    ['FITNESS FIRST', 'entertainment'], ['GOLDS GYM', 'entertainment'], ['BOWLING CENTRE', 'entertainment'],
    ['INTERNATIONAL SCHOOL FEES', 'education'], ['CITY UNIVERSITY', 'education'], ['BRIGHT KIDS NURSERY', 'education'],
    ['BINANCE', 'investing'], ['ETORO', 'investing'], ['INTERACTIVE BROKERS', 'investing'],
  ],
};

const brandOf = (descriptor) => descriptor.toUpperCase()
  .replace(/^(?:SQ|TST|PAYPAL)\s*\*\s*/u, '').split(/[\s*#.\/&'-]+/u).filter(Boolean)[0];

const MERCHANTS = Object.entries(M).flatMap(([country, list]) =>
  list.map(([descriptor, category]) => ({ descriptor, country, category, group: brandOf(descriptor) })));

module.exports = { MERCHANTS };

if (require.main === module) {
  const by = {};
  for (const m of MERCHANTS) by[m.category] = (by[m.category] ?? 0) + 1;
  console.log(MERCHANTS.length, new Set(MERCHANTS.map((m) => m.group)).size, by);
}
