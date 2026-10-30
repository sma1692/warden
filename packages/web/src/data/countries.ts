// Country dial codes for the WhatsApp login picker, plus offline locale detection.

export interface Country {
  iso: string;
  name: string;
  dial: string;
}

const RAW: [string, string, string][] = [
  ['AF', 'Afghanistan', '93'], ['AL', 'Albania', '355'], ['DZ', 'Algeria', '213'],
  ['AS', 'American Samoa', '1684'], ['AD', 'Andorra', '376'], ['AO', 'Angola', '244'],
  ['AI', 'Anguilla', '1264'], ['AG', 'Antigua and Barbuda', '1268'], ['AR', 'Argentina', '54'],
  ['AM', 'Armenia', '374'], ['AW', 'Aruba', '297'], ['AU', 'Australia', '61'],
  ['AT', 'Austria', '43'], ['AZ', 'Azerbaijan', '994'], ['BS', 'Bahamas', '1242'],
  ['BH', 'Bahrain', '973'], ['BD', 'Bangladesh', '880'], ['BB', 'Barbados', '1246'],
  ['BY', 'Belarus', '375'], ['BE', 'Belgium', '32'], ['BZ', 'Belize', '501'],
  ['BJ', 'Benin', '229'], ['BM', 'Bermuda', '1441'], ['BT', 'Bhutan', '975'],
  ['BO', 'Bolivia', '591'], ['BA', 'Bosnia and Herzegovina', '387'], ['BW', 'Botswana', '267'],
  ['BR', 'Brazil', '55'], ['VG', 'British Virgin Islands', '1284'], ['BN', 'Brunei', '673'],
  ['BG', 'Bulgaria', '359'], ['BF', 'Burkina Faso', '226'], ['BI', 'Burundi', '257'],
  ['KH', 'Cambodia', '855'], ['CM', 'Cameroon', '237'], ['CA', 'Canada', '1'],
  ['CV', 'Cape Verde', '238'], ['KY', 'Cayman Islands', '1345'], ['CF', 'Central African Republic', '236'],
  ['TD', 'Chad', '235'], ['CL', 'Chile', '56'], ['CN', 'China', '86'],
  ['CO', 'Colombia', '57'], ['KM', 'Comoros', '269'], ['CG', 'Congo', '242'],
  ['CD', 'Congo (DRC)', '243'], ['CK', 'Cook Islands', '682'], ['CR', 'Costa Rica', '506'],
  ['CI', "Côte d'Ivoire", '225'], ['HR', 'Croatia', '385'], ['CU', 'Cuba', '53'],
  ['CW', 'Curaçao', '599'], ['CY', 'Cyprus', '357'], ['CZ', 'Czechia', '420'],
  ['DK', 'Denmark', '45'], ['DJ', 'Djibouti', '253'], ['DM', 'Dominica', '1767'],
  ['DO', 'Dominican Republic', '1809'], ['EC', 'Ecuador', '593'], ['EG', 'Egypt', '20'],
  ['SV', 'El Salvador', '503'], ['GQ', 'Equatorial Guinea', '240'], ['ER', 'Eritrea', '291'],
  ['EE', 'Estonia', '372'], ['SZ', 'Eswatini', '268'], ['ET', 'Ethiopia', '251'],
  ['FK', 'Falkland Islands', '500'], ['FO', 'Faroe Islands', '298'], ['FJ', 'Fiji', '679'],
  ['FI', 'Finland', '358'], ['FR', 'France', '33'], ['GF', 'French Guiana', '594'],
  ['PF', 'French Polynesia', '689'], ['GA', 'Gabon', '241'], ['GM', 'Gambia', '220'],
  ['GE', 'Georgia', '995'], ['DE', 'Germany', '49'], ['GH', 'Ghana', '233'],
  ['GI', 'Gibraltar', '350'], ['GR', 'Greece', '30'], ['GL', 'Greenland', '299'],
  ['GD', 'Grenada', '1473'], ['GP', 'Guadeloupe', '590'], ['GU', 'Guam', '1671'],
  ['GT', 'Guatemala', '502'], ['GG', 'Guernsey', '44'], ['GN', 'Guinea', '224'],
  ['GW', 'Guinea-Bissau', '245'], ['GY', 'Guyana', '592'], ['HT', 'Haiti', '509'],
  ['HN', 'Honduras', '504'], ['HK', 'Hong Kong', '852'], ['HU', 'Hungary', '36'],
  ['IS', 'Iceland', '354'], ['IN', 'India', '91'], ['ID', 'Indonesia', '62'],
  ['IR', 'Iran', '98'], ['IQ', 'Iraq', '964'], ['IE', 'Ireland', '353'],
  ['IM', 'Isle of Man', '44'], ['IL', 'Israel', '972'], ['IT', 'Italy', '39'],
  ['JM', 'Jamaica', '1876'], ['JP', 'Japan', '81'], ['JE', 'Jersey', '44'],
  ['JO', 'Jordan', '962'], ['KZ', 'Kazakhstan', '7'], ['KE', 'Kenya', '254'],
  ['KI', 'Kiribati', '686'], ['XK', 'Kosovo', '383'], ['KW', 'Kuwait', '965'],
  ['KG', 'Kyrgyzstan', '996'], ['LA', 'Laos', '856'], ['LV', 'Latvia', '371'],
  ['LB', 'Lebanon', '961'], ['LS', 'Lesotho', '266'], ['LR', 'Liberia', '231'],
  ['LY', 'Libya', '218'], ['LI', 'Liechtenstein', '423'], ['LT', 'Lithuania', '370'],
  ['LU', 'Luxembourg', '352'], ['MO', 'Macau', '853'], ['MG', 'Madagascar', '261'],
  ['MW', 'Malawi', '265'], ['MY', 'Malaysia', '60'], ['MV', 'Maldives', '960'],
  ['ML', 'Mali', '223'], ['MT', 'Malta', '356'], ['MH', 'Marshall Islands', '692'],
  ['MQ', 'Martinique', '596'], ['MR', 'Mauritania', '222'], ['MU', 'Mauritius', '230'],
  ['YT', 'Mayotte', '262'], ['MX', 'Mexico', '52'], ['FM', 'Micronesia', '691'],
  ['MD', 'Moldova', '373'], ['MC', 'Monaco', '377'], ['MN', 'Mongolia', '976'],
  ['ME', 'Montenegro', '382'], ['MS', 'Montserrat', '1664'], ['MA', 'Morocco', '212'],
  ['MZ', 'Mozambique', '258'], ['MM', 'Myanmar', '95'], ['NA', 'Namibia', '264'],
  ['NR', 'Nauru', '674'], ['NP', 'Nepal', '977'], ['NL', 'Netherlands', '31'],
  ['NC', 'New Caledonia', '687'], ['NZ', 'New Zealand', '64'], ['NI', 'Nicaragua', '505'],
  ['NE', 'Niger', '227'], ['NG', 'Nigeria', '234'], ['NU', 'Niue', '683'],
  ['KP', 'North Korea', '850'], ['MK', 'North Macedonia', '389'], ['MP', 'Northern Mariana Islands', '1670'],
  ['NO', 'Norway', '47'], ['OM', 'Oman', '968'], ['PK', 'Pakistan', '92'],
  ['PW', 'Palau', '680'], ['PS', 'Palestine', '970'], ['PA', 'Panama', '507'],
  ['PG', 'Papua New Guinea', '675'], ['PY', 'Paraguay', '595'], ['PE', 'Peru', '51'],
  ['PH', 'Philippines', '63'], ['PL', 'Poland', '48'], ['PT', 'Portugal', '351'],
  ['PR', 'Puerto Rico', '1787'], ['QA', 'Qatar', '974'], ['RE', 'Réunion', '262'],
  ['RO', 'Romania', '40'], ['RU', 'Russia', '7'], ['RW', 'Rwanda', '250'],
  ['KN', 'Saint Kitts and Nevis', '1869'], ['LC', 'Saint Lucia', '1758'], ['VC', 'Saint Vincent and the Grenadines', '1784'],
  ['WS', 'Samoa', '685'], ['SM', 'San Marino', '378'], ['ST', 'São Tomé and Príncipe', '239'],
  ['SA', 'Saudi Arabia', '966'], ['SN', 'Senegal', '221'], ['RS', 'Serbia', '381'],
  ['SC', 'Seychelles', '248'], ['SL', 'Sierra Leone', '232'], ['SG', 'Singapore', '65'],
  ['SX', 'Sint Maarten', '1721'], ['SK', 'Slovakia', '421'], ['SI', 'Slovenia', '386'],
  ['SB', 'Solomon Islands', '677'], ['SO', 'Somalia', '252'], ['ZA', 'South Africa', '27'],
  ['KR', 'South Korea', '82'], ['SS', 'South Sudan', '211'], ['ES', 'Spain', '34'],
  ['LK', 'Sri Lanka', '94'], ['SD', 'Sudan', '249'], ['SR', 'Suriname', '597'],
  ['SE', 'Sweden', '46'], ['CH', 'Switzerland', '41'], ['SY', 'Syria', '963'],
  ['TW', 'Taiwan', '886'], ['TJ', 'Tajikistan', '992'], ['TZ', 'Tanzania', '255'],
  ['TH', 'Thailand', '66'], ['TL', 'Timor-Leste', '670'], ['TG', 'Togo', '228'],
  ['TO', 'Tonga', '676'], ['TT', 'Trinidad and Tobago', '1868'], ['TN', 'Tunisia', '216'],
  ['TR', 'Türkiye', '90'], ['TM', 'Turkmenistan', '993'], ['TC', 'Turks and Caicos Islands', '1649'],
  ['TV', 'Tuvalu', '688'], ['UG', 'Uganda', '256'], ['UA', 'Ukraine', '380'],
  ['AE', 'United Arab Emirates', '971'], ['GB', 'United Kingdom', '44'], ['US', 'United States', '1'],
  ['UY', 'Uruguay', '598'], ['VI', 'U.S. Virgin Islands', '1340'], ['UZ', 'Uzbekistan', '998'],
  ['VU', 'Vanuatu', '678'], ['VA', 'Vatican City', '39'], ['VE', 'Venezuela', '58'],
  ['VN', 'Vietnam', '84'], ['YE', 'Yemen', '967'], ['ZM', 'Zambia', '260'],
  ['ZW', 'Zimbabwe', '263'],
];

export const COUNTRIES: Country[] = RAW.map(([iso, name, dial]) => ({ iso, name, dial }));

export const findCountry = (iso: string): Country | undefined => COUNTRIES.find((c) => c.iso === iso);

export const flagEmoji = (iso: string): string =>
  String.fromCodePoint(...iso.toUpperCase().split('').map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

const PRIMARY_FOR_SHARED_DIAL = new Set(['US', 'GB', 'RU', 'IT', 'RE']);

// Matches "india", "ind", "91", "+91", "IN".
export const searchCountries = (query: string): Country[] => {
  const q = query.trim().toLowerCase().replace(/^\+/, '');
  if (!q) return COUNTRIES;
  const isDigits = /^\d+$/.test(q);
  const hits = COUNTRIES.filter((c) =>
    isDigits ? c.dial.startsWith(q) : c.name.toLowerCase().includes(q) || c.iso.toLowerCase() === q
  );
  // Exact dial (main country of a shared code first) / name-prefix matches first.
  const rank = (c: Country) =>
    isDigits
      ? c.dial === q
        ? PRIMARY_FOR_SHARED_DIAL.has(c.iso) ? 0 : 1
        : 2
      : c.name.toLowerCase().startsWith(q) || c.iso.toLowerCase() === q ? 0 : 1;
  return hits.sort((a, b) => rank(a) - rank(b));
};

// IANA time zone -> country. Covers zones whose country is unambiguous; detection
// stays on-device (no IP lookup, no permission prompt).
const TZ_TO_ISO: Record<string, string> = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD',
  'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP', 'Asia/Colombo': 'LK', 'Asia/Thimphu': 'BT',
  'Indian/Maldives': 'MV', 'Asia/Kabul': 'AF', 'Asia/Dubai': 'AE', 'Asia/Muscat': 'OM',
  'Asia/Qatar': 'QA', 'Asia/Bahrain': 'BH', 'Asia/Kuwait': 'KW', 'Asia/Riyadh': 'SA',
  'Asia/Baghdad': 'IQ', 'Asia/Tehran': 'IR', 'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL',
  'Asia/Amman': 'JO', 'Asia/Beirut': 'LB', 'Asia/Damascus': 'SY', 'Asia/Gaza': 'PS',
  'Asia/Hebron': 'PS', 'Asia/Aden': 'YE', 'Europe/Istanbul': 'TR', 'Asia/Istanbul': 'TR',
  'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Baku': 'AZ', 'Asia/Tashkent': 'UZ',
  'Asia/Samarkand': 'UZ', 'Asia/Bishkek': 'KG', 'Asia/Dushanbe': 'TJ', 'Asia/Ashgabat': 'TM',
  'Asia/Almaty': 'KZ', 'Asia/Qostanay': 'KZ', 'Asia/Aqtobe': 'KZ', 'Asia/Aqtau': 'KZ',
  'Asia/Atyrau': 'KZ', 'Asia/Oral': 'KZ', 'Asia/Qyzylorda': 'KZ',
  'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Harbin': 'CN', 'Asia/Urumqi': 'CN',
  'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW', 'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR', 'Asia/Pyongyang': 'KP', 'Asia/Ulaanbaatar': 'MN', 'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Jakarta': 'ID', 'Asia/Pontianak': 'ID',
  'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Manila': 'PH', 'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA',
  'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM', 'Asia/Brunei': 'BN', 'Asia/Dili': 'TL',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT',
  'Atlantic/Azores': 'PT', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES',
  'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Amsterdam': 'NL', 'Europe/Luxembourg': 'LU',
  'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT',
  'Europe/Rome': 'IT', 'Europe/Malta': 'MT', 'Europe/Monaco': 'MC', 'Europe/Andorra': 'AD',
  'Europe/San_Marino': 'SM', 'Europe/Vatican': 'VA', 'Europe/Vaduz': 'LI', 'Europe/Copenhagen': 'DK',
  'Europe/Oslo': 'NO', 'Europe/Stockholm': 'SE', 'Europe/Helsinki': 'FI', 'Europe/Tallinn': 'EE',
  'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ',
  'Europe/Bratislava': 'SK', 'Europe/Budapest': 'HU', 'Europe/Ljubljana': 'SI', 'Europe/Zagreb': 'HR',
  'Europe/Sarajevo': 'BA', 'Europe/Belgrade': 'RS', 'Europe/Podgorica': 'ME', 'Europe/Skopje': 'MK',
  'Europe/Tirane': 'AL', 'Europe/Athens': 'GR', 'Europe/Sofia': 'BG', 'Europe/Bucharest': 'RO',
  'Europe/Chisinau': 'MD', 'Europe/Kiev': 'UA', 'Europe/Kyiv': 'UA', 'Europe/Minsk': 'BY',
  'Europe/Moscow': 'RU', 'Europe/Samara': 'RU', 'Europe/Volgograd': 'RU', 'Asia/Yekaterinburg': 'RU',
  'Asia/Novosibirsk': 'RU', 'Asia/Krasnoyarsk': 'RU', 'Asia/Irkutsk': 'RU', 'Asia/Vladivostok': 'RU',
  'Asia/Nicosia': 'CY', 'Europe/Nicosia': 'CY', 'Atlantic/Reykjavik': 'IS', 'Europe/Gibraltar': 'GI',
  'Europe/Isle_of_Man': 'IM', 'Europe/Jersey': 'JE', 'Europe/Guernsey': 'GG', 'Atlantic/Faroe': 'FO',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US',
  'America/Los_Angeles': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Detroit': 'US',
  'America/Boise': 'US', 'America/Indiana/Indianapolis': 'US', 'America/Kentucky/Louisville': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA',
  'America/Halifax': 'CA', 'America/St_Johns': 'CA', 'America/Regina': 'CA', 'America/Montreal': 'CA',
  'America/Mexico_City': 'MX', 'America/Cancun': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX',
  'America/Guatemala': 'GT', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI',
  'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Havana': 'CU', 'America/Jamaica': 'JM',
  'America/Port-au-Prince': 'HT', 'America/Santo_Domingo': 'DO', 'America/Puerto_Rico': 'PR',
  'America/Port_of_Spain': 'TT', 'America/Barbados': 'BB', 'America/Nassau': 'BS', 'America/Belize': 'BZ',
  'America/Bogota': 'CO', 'America/Caracas': 'VE', 'America/Guayaquil': 'EC', 'America/Lima': 'PE',
  'America/La_Paz': 'BO', 'America/Santiago': 'CL', 'America/Asuncion': 'PY', 'America/Montevideo': 'UY',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR',
  'America/Sao_Paulo': 'BR', 'America/Manaus': 'BR', 'America/Fortaleza': 'BR', 'America/Recife': 'BR',
  'America/Bahia': 'BR', 'America/Belem': 'BR', 'America/Guyana': 'GY', 'America/Paramaribo': 'SR',
  'America/Cayenne': 'GF', 'America/Godthab': 'GL', 'America/Nuuk': 'GL', 'Atlantic/Bermuda': 'BM',
  'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN',
  'Africa/Tripoli': 'LY', 'Africa/Khartoum': 'SD', 'Africa/Juba': 'SS', 'Africa/Addis_Ababa': 'ET',
  'Africa/Nairobi': 'KE', 'Africa/Kampala': 'UG', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kigali': 'RW',
  'Africa/Mogadishu': 'SO', 'Africa/Djibouti': 'DJ', 'Africa/Asmara': 'ER', 'Africa/Lagos': 'NG',
  'Africa/Accra': 'GH', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Bamako': 'ML',
  'Africa/Ouagadougou': 'BF', 'Africa/Niamey': 'NE', 'Africa/Conakry': 'GN', 'Africa/Freetown': 'SL',
  'Africa/Monrovia': 'LR', 'Africa/Lome': 'TG', 'Africa/Porto-Novo': 'BJ', 'Africa/Douala': 'CM',
  'Africa/Libreville': 'GA', 'Africa/Kinshasa': 'CD', 'Africa/Lubumbashi': 'CD', 'Africa/Brazzaville': 'CG',
  'Africa/Luanda': 'AO', 'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW', 'Africa/Maputo': 'MZ',
  'Africa/Blantyre': 'MW', 'Africa/Gaborone': 'BW', 'Africa/Windhoek': 'NA', 'Africa/Johannesburg': 'ZA',
  'Africa/Maseru': 'LS', 'Africa/Mbabane': 'SZ', 'Indian/Antananarivo': 'MG', 'Indian/Mauritius': 'MU',
  'Indian/Reunion': 'RE', 'Indian/Mahe': 'SC', 'Africa/Banjul': 'GM', 'Africa/Nouakchott': 'MR',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU', 'Australia/Hobart': 'AU', 'Australia/Darwin': 'AU', 'Australia/Canberra': 'AU',
  'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ', 'Pacific/Fiji': 'FJ', 'Pacific/Port_Moresby': 'PG',
  'Pacific/Guam': 'GU', 'Pacific/Noumea': 'NC', 'Pacific/Tahiti': 'PF', 'Pacific/Apia': 'WS',
  'Pacific/Tongatapu': 'TO', 'Pacific/Efate': 'VU', 'Pacific/Guadalcanal': 'SB',
};

/**
 * Best-guess country from the device locale: time zone first (tracks physical
 * location even on an en-US browser), then the language region tag.
 */
export const detectCountryIso = (fallback = 'US'): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fromTz = tz ? TZ_TO_ISO[tz] : undefined;
    if (fromTz && findCountry(fromTz)) return fromTz;
  } catch {
    /* Intl unavailable */
  }
  const langs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const lang of langs) {
    const region = lang?.split('-')[1]?.toUpperCase();
    if (region && region.length === 2 && findCountry(region)) return region;
  }
  return fallback;
};
