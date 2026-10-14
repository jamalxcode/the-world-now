package main

// Enrichment after fetching: which countries a headline is about, which wire service a story came from,
// and folding syndicated copies (the same wire story republished by several outlets) into the earliest one.
// Also the per-source schedule: sources that fetch less often, and failing sources that get "parked".

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

// ---------- countries ----------

// geoNames maps place names, demonyms, capitals, big cities and a few institutions to ISO country codes.
// Matching is on whole words, and a word must be capitalised in the headline ("Turkey" the country,
// not "turkey" the bird). Ambiguous names (Georgia, Chad, Guinea…) are left out on purpose.
// app.js has the matching region table (which countries form the Gulf, Europe…).
const geoData = `
KW:Kuwait|Kuwaiti|Kuwaitis|Kuwait City
SA:Saudi|Saudis|Saudi Arabia|Riyadh|Jeddah|Mecca|Makkah|Medina|Aramco
AE:Emirati|Emiratis|Emirates|Dubai|Abu Dhabi|Sharjah
QA:Qatar|Qatari|Qataris|Doha
BH:Bahrain|Bahraini|Bahrainis|Manama
OM:Oman|Omani|Omanis|Muscat
IQ:Iraq|Iraqi|Iraqis|Baghdad|Basra|Mosul|Erbil|Kurdistan
IR:Iran|Iranian|Iranians|Tehran|Isfahan
YE:Yemen|Yemeni|Yemenis|Sanaa|Aden|Houthi|Houthis|Hodeidah
JO:Jordan|Jordanian|Jordanians|Amman
LB:Lebanon|Lebanese|Beirut|Hezbollah
SY:Syria|Syrian|Syrians|Damascus|Aleppo|Idlib
IL:Israel|Israeli|Israelis|Tel Aviv|Jerusalem
PS:Palestine|Palestinian|Palestinians|Gaza|West Bank|Hamas|Ramallah|Rafah
TR:Turkey|Türkiye|Turkiye|Turkish|Ankara|Istanbul
EG:Egypt|Egyptian|Egyptians|Cairo|Suez
LY:Libya|Libyan|Libyans|Tripoli|Benghazi
TN:Tunisia|Tunisian|Tunis
DZ:Algeria|Algerian|Algiers
MA:Morocco|Moroccan|Rabat|Casablanca
SD:Sudan|Sudanese|Khartoum|Darfur
SS:South Sudan|South Sudanese|Juba
US:America|American|Americans|United States|Lebanon County|Washington|White House|Pentagon|New York|California|Texas|Florida|Chicago|Los Angeles|San Francisco|Seattle|Boston|Miami|Atlanta|Houston|Dallas|Philadelphia|Detroit|Las Vegas|San Diego|Wall Street|Capitol Hill|Silicon Valley
CA:Canada|Canadian|Canadians|Ottawa|Toronto|Vancouver|Montreal|Quebec|Alberta
MX:Mexico|Mexican|Mexicans|Mexico City
GB:Britain|British|United Kingdom|England|Scotland|Scottish|Wales|Welsh|Northern Ireland|London|Manchester|Downing Street|Westminster|Brexit
IE:Ireland|Irish|Dublin
FR:France|French|Paris|Marseille|Lyon|Elysee|Élysée
DE:Germany|German|Germans|Berlin|Munich|Frankfurt|Bundestag
NL:Netherlands|Dutch|Amsterdam|The Hague|Rotterdam
BE:Belgium|Belgian|Brussels
CH:Switzerland|Swiss|Geneva|Zurich|Davos
AT:Austria|Austrian|Vienna
IT:Italy|Italian|Italians|Rome|Milan|Naples|Vatican
ES:Spain|Spanish|Madrid|Barcelona|Catalonia
PT:Portugal|Portuguese|Lisbon
GR:Greece|Greek|Greeks|Athens
CY:Cyprus|Cypriot|Nicosia
MT:Malta|Maltese
PL:Poland|Polish|Poles|Warsaw
CZ:Czech|Czechia|Prague
SK:Slovakia|Slovak|Bratislava
HU:Hungary|Hungarian|Budapest
RO:Romania|Romanian|Bucharest
BG:Bulgaria|Bulgarian|Sofia
UA:Ukraine|Ukrainian|Ukrainians|Kyiv|Kiev|Kharkiv|Odesa|Odessa|Lviv|Donbas|Donetsk|Luhansk|Crimea|Zaporizhzhia|Kherson|Dnipro
RU:Russia|Russian|Russians|Moscow|Kremlin|St Petersburg|Saint Petersburg|Siberia|Kursk|Belgorod
BY:Belarus|Belarusian|Minsk
MD:Moldova|Moldovan|Chisinau
RS:Serbia|Serbian|Belgrade
HR:Croatia|Croatian|Zagreb
BA:Bosnia|Bosnian|Sarajevo
XK:Kosovo|Pristina
AL:Albania|Albanian|Tirana
SE:Sweden|Swedish|Stockholm
NO:Norway|Norwegian|Oslo
DK:Denmark|Danish|Copenhagen|Greenland
FI:Finland|Finnish|Helsinki
IS:Iceland|Icelandic|Reykjavik
EE:Estonia|Estonian|Tallinn
LV:Latvia|Latvian|Riga
LT:Lithuania|Lithuanian|Vilnius
GE:Tbilisi
AM:Armenia|Armenian|Yerevan
AZ:Azerbaijan|Azerbaijani|Baku
KZ:Kazakhstan|Kazakh|Astana|Almaty
UZ:Uzbekistan|Uzbek|Tashkent
TM:Turkmenistan
KG:Kyrgyzstan|Bishkek
TJ:Tajikistan|Dushanbe
AF:Afghanistan|Afghan|Afghans|Kabul|Taliban
PK:Pakistan|Pakistani|Pakistanis|Islamabad|Karachi|Lahore
IN:India|Indian|Indians|New Delhi|Delhi|Mumbai|Bengaluru|Bangalore|Kolkata|Chennai
BD:Bangladesh|Bangladeshi|Dhaka
NP:Nepal|Nepali|Nepalese|Kathmandu
LK:Sri Lanka|Sri Lankan|Colombo
MV:Maldives|Maldivian
CN:China|Chinese|Beijing|Shanghai|Shenzhen|Xinjiang|Tibet|Guangzhou|Wuhan
HK:Hong Kong
TW:Taiwan|Taiwanese|Taipei
JP:Japan|Japanese|Tokyo|Osaka
KR:South Korea|South Korean|Seoul
KP:North Korea|North Korean|Pyongyang
MN:Mongolia|Mongolian|Ulaanbaatar
SG:Singapore|Singaporean
MY:Malaysia|Malaysian|Kuala Lumpur
ID:Indonesia|Indonesian|Jakarta|Bali
PH:Philippines|Philippine|Filipino|Filipinos|Manila
TH:Thailand|Thai|Bangkok
VN:Vietnam|Vietnamese|Hanoi|Ho Chi Minh City
MM:Myanmar|Burma|Burmese|Yangon
KH:Cambodia|Cambodian|Phnom Penh
LA:Laos|Vientiane
AU:Australia|Australian|Australians|Canberra|Sydney|Melbourne|Brisbane|Perth
NZ:New Zealand|Auckland
PG:Papua New Guinea
FJ:Fiji|Fijian
BR:Brazil|Brazilian|Brasilia|Rio de Janeiro|Sao Paulo|São Paulo
AR:Argentina|Argentine|Argentinian|Buenos Aires
CL:Chile|Chilean|Santiago
CO:Colombia|Colombian|Bogota|Bogotá
PE:Peru|Peruvian|Lima
VE:Venezuela|Venezuelan|Caracas
EC:Ecuador|Ecuadorian|Quito
BO:Bolivia|Bolivian
PY:Paraguay|Paraguayan
UY:Uruguay|Uruguayan|Montevideo
CU:Cuba|Cuban|Havana
HT:Haiti|Haitian
DO:Dominican Republic|Santo Domingo
JM:Jamaica|Jamaican
GT:Guatemala|Guatemalan
HN:Honduras|Honduran
SV:El Salvador|Salvadoran
NI:Nicaragua|Nicaraguan
CR:Costa Rica|Costa Rican
PA:Panama|Panamanian
NG:Nigeria|Nigerian|Nigerians|Abuja|Lagos
GH:Ghana|Ghanaian|Accra
SN:Senegal|Senegalese|Dakar
CI:Ivory Coast|Ivorian|Abidjan
ML:Mali|Malian|Bamako
BF:Burkina Faso|Ouagadougou
NE:Niger|Niamey
CM:Cameroon|Cameroonian
KE:Kenya|Kenyan|Nairobi
ET:Ethiopia|Ethiopian|Addis Ababa|Tigray
SO:Somalia|Somali|Mogadishu|Somaliland
UG:Uganda|Ugandan|Kampala
TZ:Tanzania|Tanzanian|Dar es Salaam
RW:Rwanda|Rwandan|Kigali
CD:Congo|Congolese|Kinshasa|Goma
AO:Angola|Angolan|Luanda
ZA:South Africa|South African|Pretoria|Johannesburg|Cape Town
ZW:Zimbabwe|Zimbabwean|Harare
ZM:Zambia|Zambian|Lusaka
MZ:Mozambique|Mozambican|Maputo
MG:Madagascar|Malagasy
ER:Eritrea|Eritrean|Asmara
DJ:Djibouti
`

// Upper-case abbreviations, matched exactly ("US" the country, never "us").
var geoAbbrev = map[string]string{"US": "US", "USA": "US", "UK": "GB", "UAE": "AE", "KSA": "SA", "DRC": "CD", "IRGC": "IR", "FBI": "US", "CIA": "US"}

var (
	geoNames    map[string]string // lower-case name (1–3 words) → code
	geoWordRE   = regexp.MustCompile(`[\p{L}][\p{L}.'’-]*`)
	possessive  = strings.NewReplacer("’s", "", "'s", "")
	geoMaxWords = 3
)

// Arabic names for the countries Arabic headlines name most (with the article "ال" where Arabic uses it).
// "عمان" is left out: without vowel marks it is both Oman and Amman.
const geoDataArabic = `
KW:الكويت|كويتي|الكويتي|الكويتية
SA:السعودية|السعودي|الرياض|جدة|مكة
AE:الإمارات|الإماراتي|الإماراتية|دبي|أبوظبي|ابوظبي|الشارقة
QA:قطر|القطري|القطرية|الدوحة
BH:البحرين|البحريني|البحرينية|المنامة
OM:مسقط|العماني|العمانية
IQ:العراق|العراقي|العراقية|بغداد|البصرة|أربيل
IR:إيران|ايران|الإيراني|الإيرانية|طهران
YE:اليمن|اليمني|اليمنية|الحوثي|الحوثيين|الحوثيون|صنعاء|عدن
JO:الأردن|الاردن|الأردني|الأردنية
LB:لبنان|اللبناني|اللبنانية|بيروت
SY:سوريا|سورية|السوري|السورية|دمشق|حلب
IL:إسرائيل|اسرائيل|الإسرائيلي|الإسرائيلية|تل أبيب
PS:فلسطين|الفلسطيني|الفلسطينية|الفلسطينيين|غزة|الضفة|حماس|رفح
TR:تركيا|التركي|التركية|أنقرة|إسطنبول
EG:مصر|المصري|المصرية|القاهرة
SD:السودان|السوداني|الخرطوم
LY:ليبيا|الليبي|طرابلس
US:أمريكا|أميركا|الأمريكي|الأمريكية|الأميركي|الأميركية|واشنطن
RU:روسيا|الروسي|الروسية|موسكو|الكرملين
UA:أوكرانيا|الأوكراني|الأوكرانية|كييف
CN:الصين|الصيني|الصينية|بكين
GB:بريطانيا|البريطاني|البريطانية|لندن
FR:فرنسا|الفرنسي|الفرنسية|باريس
DE:ألمانيا|الألماني|الألمانية|برلين
IN:الهند|الهندي|الهندية
PK:باكستان|الباكستاني|الباكستانية
`

func init() {
	geoNames = map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(geoData)+"\n"+strings.TrimSpace(geoDataArabic), "\n") {
		code, names, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		for _, n := range strings.Split(names, "|") {
			geoNames[strings.ToLower(n)] = code
		}
	}
}

// Companies named after a country: "Kuwait Finance House Bahrain signs…" is Bahraini news, and "Qatar
// Airways adds Lisbon flights" is about Portugal. When the headline names another country too, the
// company's name doesn't count; when it names none, the company's country stands.
var companyRE = regexp.MustCompile(`\b(National Bank of Kuwait|Kuwait Finance House|Commercial Bank of Kuwait|Kuwait Airways|Kuwait Petroleum(?: Corporation)?|Qatar National Bank|Qatar Airways|QatarEnergy|Saudi Aramco|Saudi National Bank|Saudi Arabian Airlines|Emirates NBD|Emirates Airline|First Abu Dhabi Bank|Abu Dhabi Commercial Bank|Abu Dhabi Islamic Bank|Dubai Islamic Bank|Oman Air|Gulf Air|Bank of America|Bank of China|Air India|Air China|Air Canada|Air France|Japan Airlines|Turkish Airlines|Singapore Airlines|Korean Air|Royal Jordanian|Pakistan International Airlines|Saudia|Etihad(?: Airways)?)\b`)

// detectGeo returns the countries a headline names, in order of first mention.
func detectGeo(title string) []string {
	if masked := companyRE.ReplaceAllString(title, " · "); masked != title {
		if g := detectGeoWords(masked); len(g) > 0 {
			return g
		}
	}
	return detectGeoWords(title)
}

// cleanOutlet tidies the outlet name an aggregator gives: "https://www.aainnwes.com/" → "aainnwes.com",
// "Kuwait News -" → "Kuwait News". "" when nothing usable is left.
func cleanOutlet(s string) string {
	s = strings.TrimSpace(s)
	if low := strings.ToLower(s); strings.Contains(low, "://") || strings.HasPrefix(low, "www.") {
		raw := s
		if !strings.Contains(raw, "://") {
			raw = "https://" + raw
		}
		if u, err := url.Parse(raw); err == nil && u.Hostname() != "" {
			s = strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
		}
	}
	return strings.TrimSpace(strings.TrimRight(s, " -–—|:·,"))
}

func detectGeoWords(title string) []string {
	var words []string
	for _, w := range geoWordRE.FindAllString(title, -1) {
		w = strings.Trim(possessive.Replace(w), ".-'’")
		if strings.Count(w, ".") > 0 && strings.ToUpper(w) == w { // "U.S." → "US"
			w = strings.ReplaceAll(w, ".", "")
		}
		if w != "" {
			words = append(words, w)
		}
	}
	var out []string
	seen := map[string]bool{}
	add := func(c string) {
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	for i := 0; i < len(words); {
		matched := 0
		for n := geoMaxWords; n >= 1 && matched == 0; n-- {
			if i+n > len(words) {
				continue
			}
			span := words[i : i+n]
			if n == 1 {
				if c, ok := geoAbbrev[span[0]]; ok {
					add(c)
					matched = 1
					continue
				}
			}
			if !capitalised(span) {
				continue
			}
			if c, ok := geoNames[strings.ToLower(strings.Join(span, " "))]; ok {
				add(c)
				matched = n
			} else if n == 1 {
				for _, v := range arabicForms(span[0]) { // "بالكويت" → "الكويت"
					if c, ok := geoNames[v]; ok {
						add(c)
						matched = 1
						break
					}
				}
			}
		}
		if matched == 0 {
			matched = 1
		}
		i += matched
	}
	return out
}

func capitalised(words []string) bool {
	for _, w := range words {
		r := []rune(w)
		// "of", "es", "de" may sit inside a name ("Dar es Salaam", "Rio de Janeiro").
		if len(r) == 0 || (!nameStart(r[0]) && len(r) > 3) {
			return false
		}
	}
	return nameStart([]rune(words[0])[0])
}

// A capital letter, or a letter from a script without capitals (Arabic), where any word may be a name.
func nameStart(r rune) bool {
	return unicode.IsUpper(r) || (unicode.IsLetter(r) && !unicode.IsLower(r))
}

// Arabic attaches "and", "in", "to", "for" to the word: والكويت, بالكويت, للكويت, فالعراق.
func arabicForms(w string) []string {
	if !unicode.Is(unicode.Arabic, []rune(w + " ")[0]) {
		return nil
	}
	var out []string
	for _, p := range []string{"وال", "بال", "فال", "كال"} {
		if strings.HasPrefix(w, p) {
			out = append(out, "ال"+strings.TrimPrefix(w, p))
		}
	}
	if strings.HasPrefix(w, "لل") {
		out = append(out, "ال"+strings.TrimPrefix(w, "لل"))
	}
	for _, p := range []string{"و", "ب", "ل", "ف"} {
		if strings.HasPrefix(w, p) {
			out = append(out, strings.TrimPrefix(w, p))
		}
	}
	return out
}

// ---------- wire services ----------

// A syndicated story usually opens with the agency's name: "DUBAI (Reuters) - …", "WASHINGTON, Oct 14
// (AP) — …". Some feeds put a byline or photo caption first, so the dateline may come a little later.
var viaRE = regexp.MustCompile(`(?:^|[.!?"”]\s+|\n)\W{0,3}(?:[A-Z][A-Za-z0-9.,' /-]{0,50})?\(\s*(Reuters|AP|AFP|Agence France-Presse|Associated Press|Bloomberg|dpa|ANI|PTI|IANS|Xinhua|WAM|SPA|KUNA|QNA|ONA|BNA|Anadolu)\s*\)\s*[-–—:]`)

// …or ends with the agency's credit line.
var viaCreditRE = regexp.MustCompile(`(?i)(?:\(\s*(Reuters|AP|AFP)\s*\)\s*$|\b(?:reporting by [^.]{3,80}(?:;|\.)\s*(?:additional reporting|editing by)|editing by [A-Z][a-z]+ [A-Z][a-z]+\s*$)|copyright \d{4} (?:the )?associated press)`)

func detectVia(summary, source string) string {
	head := summary
	if len(head) > 400 {
		head = head[:400]
	}
	via := ""
	if m := viaRE.FindStringSubmatch(head); m != nil {
		via = m[1]
	} else if m := viaCreditRE.FindStringSubmatch(summary); m != nil {
		switch {
		case m[1] != "":
			via = strings.ToUpper(m[1])
			if via == "REUTERS" {
				via = "Reuters"
			}
		case strings.Contains(strings.ToLower(m[0]), "associated press"):
			via = "AP"
		default:
			via = "Reuters" // "Reporting by …; Editing by …" is Reuters' house style
		}
	}
	if via == "" {
		return ""
	}
	switch via {
	case "Agence France-Presse":
		via = "AFP"
	case "Associated Press":
		via = "AP"
	}
	if f := strings.Fields(source); len(f) > 0 && strings.EqualFold(via, f[0]) { // "Reuters", "AP News", "AFP English"
		return ""
	}
	return via
}

// ---------- syndicated copies ----------

var dupStop = map[string]bool{}

func init() {
	for _, w := range strings.Fields("the and for are was were has had have his her its our not but all any can out who how why what when where new one two says said say after over amid with from into about against more most than that this these those will would could should their them they been being just also news live video watch update updates latest breaking exclusive") {
		dupStop[w] = true
	}
}

func dupTokens(title string) map[string]bool {
	set := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(title), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if len([]rune(w)) >= 3 && !dupStop[w] {
			set[w] = true
		}
	}
	return set
}

// foldSyndicated drops later near-copies of a headline (the same wire story republished by other
// outlets, often word for word) and keeps the earliest, listing the copies' outlets in Also.
// Different outlets' own reporting on the same story is NOT folded; the page groups that instead.
// Items must be sorted newest first; the result is too.
func foldSyndicated(items []Item) []Item {
	type kept struct {
		idx  int
		toks map[string]bool
	}
	var keep []kept
	drop := make([]bool, len(items))
	for i := len(items) - 1; i >= 0; i-- { // oldest first, so the earliest copy wins
		it := &items[i]
		toks := dupTokens(it.Title)
		if len(toks) < 4 {
			keep = append(keep, kept{i, toks})
			continue
		}
		dupOf := -1
		for k := len(keep) - 1; k >= 0; k-- {
			o := &items[keep[k].idx]
			if o.t.Sub(it.t) > 36*time.Hour || it.t.Sub(o.t) > 36*time.Hour || o.Media != it.Media || o.Source == it.Source {
				continue
			}
			if jaccard(toks, keep[k].toks) >= 0.75 {
				dupOf = keep[k].idx
				break
			}
		}
		if dupOf < 0 {
			keep = append(keep, kept{i, toks})
			continue
		}
		o := &items[dupOf]
		if o.Via == "" && it.Via != "" {
			o.Via = it.Via
		}
		if len(o.Also) < 8 && !contains(o.Also, it.Source) {
			o.Also = append(o.Also, it.Source)
		}
		for _, a := range it.Also {
			if len(o.Also) < 8 && a != o.Source && !contains(o.Also, a) {
				o.Also = append(o.Also, a)
			}
		}
		drop[i] = true
	}
	out := items[:0]
	for i, it := range items {
		if !drop[i] {
			out = append(out, it)
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].t.After(out[b].t) })
	return out
}

func jaccard(a, b map[string]bool) float64 {
	inter := 0
	for w := range a {
		if b[w] {
			inter++
		}
	}
	union := len(a) + len(b) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

// ---------- schedule & health ----------

// sourceKey identifies a source across builds (names can repeat: "NYT" has two feeds).
func sourceKey(src Source) string {
	return src.Type + "|" + firstNonEmpty(src.URL, src.Channel, src.Handle)
}

const (
	parkAfter = 24 * time.Hour // a source failing this long is parked…
	parkRetry = 6 * time.Hour  // …and only retried this often
)

// due reports whether a source should be fetched this run, and whether it is parked.
func due(src Source, prev SourceStatus, hadPrev bool, now time.Time) (fetch, parked bool) {
	if !hadPrev {
		return true, false
	}
	last, _ := time.Parse(time.RFC3339, prev.LastTry)
	failing, _ := time.Parse(time.RFC3339, prev.FailingSince)
	if !failing.IsZero() && now.Sub(failing) > parkAfter {
		return now.Sub(last) >= parkRetry, true
	}
	if src.EveryMinutes > 0 && !last.IsZero() && now.Sub(last) < time.Duration(src.EveryMinutes)*time.Minute-30*time.Second {
		return false, false
	}
	return true, false
}
