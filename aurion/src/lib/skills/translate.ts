/* ─── Translation Lexicons — Hindi, Telugu, Spanish, French, German, Tamil ─── */

/* ── Phrase memory (exact matches) ── */
const PHRASE_MEMORY: Record<string, Record<string, string>> = {
  'hello': { hi: 'नमस्ते', te: 'నమస్కారం', es: 'Hola', fr: 'Bonjour', de: 'Hallo', ta: 'வணக்கம்' },
  'good morning': { hi: 'सुप्रभात', te: 'శుభోదయం', es: 'Buenos días', fr: 'Bonjour', de: 'Guten Morgen', ta: 'காலை வணக்கம்' },
  'good evening': { hi: 'शुभ संध्या', te: 'శుభ సాయంత్రం', es: 'Buenas tardes', fr: 'Bonsoir', de: 'Guten Abend', ta: 'மாலை வணக்கம்' },
  'good night': { hi: 'शुभ रात्रि', te: 'శుభ రాత్రి', es: 'Buenas noches', fr: 'Bonne nuit', de: 'Gute Nacht', ta: 'இனிய இரவு' },
  'how are you': { hi: 'आप कैसे हैं?', te: 'మీరు ఎలా ఉన్నారు?', es: '¿Cómo estás?', fr: 'Comment allez-vous?', de: 'Wie geht es Ihnen?', ta: 'நீங்கள் எப்படி இருக்கிறீர்கள்?' },
  'thank you': { hi: 'धन्यवाद', te: 'ధన్యవాదాలు', es: 'Gracias', fr: 'Merci', de: 'Danke', ta: 'நன்றி' },
  'thank you very much': { hi: 'बहुत-बहुत धन्यवाद', te: 'చాలా ధన్యవాదాలు', es: 'Muchas gracias', fr: 'Merci beaucoup', de: 'Vielen Dank', ta: 'மிக்க நன்றி' },
  'please': { hi: 'कृपया', te: 'దయచేసి', es: 'Por favor', fr: "S'il vous plaît", de: 'Bitte', ta: 'தயவுசெய்து' },
  'yes': { hi: 'हाँ', te: 'అవును', es: 'Sí', fr: 'Oui', de: 'Ja', ta: 'ஆம்' },
  'no': { hi: 'नहीं', te: 'లేదు', es: 'No', fr: 'Non', de: 'Nein', ta: 'இல்லை' },
  'sorry': { hi: 'माफ़ कीजिए', te: 'క్షమించండి', es: 'Lo siento', fr: 'Désolé', de: 'Entschuldigung', ta: 'மன்னிக்கவும்' },
  'excuse me': { hi: 'क्षमा कीजिए', te: 'క్షమించండి', es: 'Disculpe', fr: 'Excusez-moi', de: 'Entschuldigen Sie', ta: 'மன்னிக்கவும்' },
  'goodbye': { hi: 'अलविदा', te: 'వీడ్కోలు', es: 'Adiós', fr: 'Au revoir', de: 'Auf Wiedersehen', ta: 'பிரியாவிடை' },
  'welcome': { hi: 'स्वागत है', te: 'స్వాగతం', es: 'Bienvenido', fr: 'Bienvenue', de: 'Willkommen', ta: 'வரவேற்கிறோம்' },
  'i love you': { hi: 'मैं तुमसे प्यार करता हूँ', te: 'నేను నిన్ను ప్రేమిస్తున్నాను', es: 'Te quiero', fr: "Je t'aime", de: 'Ich liebe dich', ta: 'நான் உன்னை காதலிக்கிறேன்' },
  'what is your name': { hi: 'आपका नाम क्या है?', te: 'మీ పేరు ఏమిటి?', es: '¿Cómo te llamas?', fr: 'Comment vous appelez-vous?', de: 'Wie heißen Sie?', ta: 'உங்கள் பெயர் என்ன?' },
  'my name is': { hi: 'मेरा नाम है', te: 'నా పేరు', es: 'Mi nombre es', fr: 'Je m\'appelle', de: 'Mein Name ist', ta: 'என் பெயர்' },
  'how much': { hi: 'कितना?', te: 'ఎంత?', es: '¿Cuánto?', fr: 'Combien?', de: 'Wie viel?', ta: 'எவ்வளவு?' },
  'where is': { hi: 'कहाँ है?', te: 'ఎక్కడ ఉంది?', es: '¿Dónde está?', fr: 'Où est?', de: 'Wo ist?', ta: 'எங்கே இருக்கிறது?' },
  'i don\'t understand': { hi: 'मुझे समझ नहीं आया', te: 'నాకు అర్థం కాలేదు', es: 'No entiendo', fr: 'Je ne comprends pas', de: 'Ich verstehe nicht', ta: 'எனக்கு புரியவில்லை' },
  'help': { hi: 'मदद', te: 'సహాయం', es: 'Ayuda', fr: 'Aide', de: 'Hilfe', ta: 'உதவி' },
  'water': { hi: 'पानी', te: 'నీరు', es: 'Agua', fr: 'Eau', de: 'Wasser', ta: 'தண்ணீர்' },
  'food': { hi: 'खाना', te: 'ఆహారం', es: 'Comida', fr: 'Nourriture', de: 'Essen', ta: 'உணவு' },
  'friend': { hi: 'दोस्त', te: 'స్నేహితుడు', es: 'Amigo', fr: 'Ami', de: 'Freund', ta: 'நண்பன்' },
  'family': { hi: 'परिवार', te: 'కుటుంబం', es: 'Familia', fr: 'Famille', de: 'Familie', ta: 'குடும்பம்' },
  'mother': { hi: 'माँ', te: 'అమ్మ', es: 'Madre', fr: 'Mère', de: 'Mutter', ta: 'அம்மா' },
  'father': { hi: 'पिता', te: 'నాన్న', es: 'Padre', fr: 'Père', de: 'Vater', ta: 'அப்பா' },
  'child': { hi: 'बच्चा', te: 'పిల్ల', es: 'Niño', fr: 'Enfant', de: 'Kind', ta: 'குழந்தை' },
  'school': { hi: 'विद्यालय', te: 'పాఠశాల', es: 'Escuela', fr: 'École', de: 'Schule', ta: 'பள்ளி' },
  'book': { hi: 'किताब', te: 'పుస్తకం', es: 'Libro', fr: 'Livre', de: 'Buch', ta: 'புத்தகம்' },
  'house': { hi: 'घर', te: 'ఇల్లు', es: 'Casa', fr: 'Maison', de: 'Haus', ta: 'வீடு' },
  'love': { hi: 'प्यार', te: 'ప్రేమ', es: 'Amor', fr: 'Amour', de: 'Liebe', ta: 'காதல்' },
  'peace': { hi: 'शांति', te: 'శాంతి', es: 'Paz', fr: 'Paix', de: 'Frieden', ta: 'அமைதி' },
  'happy': { hi: 'खुश', te: 'సంతోషం', es: 'Feliz', fr: 'Heureux', de: 'Glücklich', ta: 'மகிழ்ச்சி' },
  'good': { hi: 'अच्छा', te: 'మంచి', es: 'Bueno', fr: 'Bon', de: 'Gut', ta: 'நல்ல' },
  'bad': { hi: 'बुरा', te: 'చెడ్డ', es: 'Malo', fr: 'Mauvais', de: 'Schlecht', ta: 'மோசமான' },
  'big': { hi: 'बड़ा', te: 'పెద్ద', es: 'Grande', fr: 'Grand', de: 'Groß', ta: 'பெரிய' },
  'small': { hi: 'छोटा', te: 'చిన్న', es: 'Pequeño', fr: 'Petit', de: 'Klein', ta: 'சிறிய' },
  'today': { hi: 'आज', te: 'ఈరోజు', es: 'Hoy', fr: "Aujourd'hui", de: 'Heute', ta: 'இன்று' },
  'tomorrow': { hi: 'कल (आने वाला)', te: 'రేపు', es: 'Mañana', fr: 'Demain', de: 'Morgen', ta: 'நாளை' },
  'yesterday': { hi: 'कल (बीता हुआ)', te: 'నిన్న', es: 'Ayer', fr: 'Hier', de: 'Gestern', ta: 'நேற்று' },
  'world': { hi: 'दुनिया', te: 'ప్రపంచం', es: 'Mundo', fr: 'Monde', de: 'Welt', ta: 'உலகம்' },
  'life': { hi: 'जीवन', te: 'జీవితం', es: 'Vida', fr: 'Vie', de: 'Leben', ta: 'வாழ்க்கை' },
  'time': { hi: 'समय', te: 'సమయం', es: 'Tiempo', fr: 'Temps', de: 'Zeit', ta: 'நேரம்' },
  'beautiful': { hi: 'सुंदर', te: 'అందమైన', es: 'Hermoso', fr: 'Beau', de: 'Schön', ta: 'அழகான' },
  'name': { hi: 'नाम', te: 'పేరు', es: 'Nombre', fr: 'Nom', de: 'Name', ta: 'பெயர்' },
  'city': { hi: 'शहर', te: 'నగరం', es: 'Ciudad', fr: 'Ville', de: 'Stadt', ta: 'நகரம்' },
  'country': { hi: 'देश', te: 'దేశం', es: 'País', fr: 'Pays', de: 'Land', ta: 'நாடு' },
  'sun': { hi: 'सूरज', te: 'సూర్యుడు', es: 'Sol', fr: 'Soleil', de: 'Sonne', ta: 'சூரியன்' },
  'moon': { hi: 'चाँद', te: 'చంద్రుడు', es: 'Luna', fr: 'Lune', de: 'Mond', ta: 'சந்திரன்' },
  'star': { hi: 'तारा', te: 'నక్షత్రం', es: 'Estrella', fr: 'Étoile', de: 'Stern', ta: 'நட்சத்திரம்' },
  'rain': { hi: 'बारिश', te: 'వాన', es: 'Lluvia', fr: 'Pluie', de: 'Regen', ta: 'மழை' },
  'eat': { hi: 'खाना', te: 'తిను', es: 'Comer', fr: 'Manger', de: 'Essen', ta: 'சாப்பிடு' },
  'drink': { hi: 'पीना', te: 'తాగు', es: 'Beber', fr: 'Boire', de: 'Trinken', ta: 'குடி' },
  'sleep': { hi: 'सोना', te: 'నిద్ర', es: 'Dormir', fr: 'Dormir', de: 'Schlafen', ta: 'தூங்கு' },
  'go': { hi: 'जाना', te: 'వెళ్ళు', es: 'Ir', fr: 'Aller', de: 'Gehen', ta: 'போ' },
  'come': { hi: 'आना', te: 'రా', es: 'Venir', fr: 'Venir', de: 'Kommen', ta: 'வா' },
  'give': { hi: 'देना', te: 'ఇవ్వు', es: 'Dar', fr: 'Donner', de: 'Geben', ta: 'கொடு' },
  'take': { hi: 'लेना', te: 'తీసుకో', es: 'Tomar', fr: 'Prendre', de: 'Nehmen', ta: 'எடு' },
  'see': { hi: 'देखना', te: 'చూడు', es: 'Ver', fr: 'Voir', de: 'Sehen', ta: 'பார்' },
  'hear': { hi: 'सुनना', te: 'విను', es: 'Oír', fr: 'Entendre', de: 'Hören', ta: 'கேள்' },
  'speak': { hi: 'बोलना', te: 'మాట్లాడు', es: 'Hablar', fr: 'Parler', de: 'Sprechen', ta: 'பேசு' },
  'read': { hi: 'पढ़ना', te: 'చదువు', es: 'Leer', fr: 'Lire', de: 'Lesen', ta: 'படி' },
  'write': { hi: 'लिखना', te: 'రాయి', es: 'Escribir', fr: 'Écrire', de: 'Schreiben', ta: 'எழுது' },
  'know': { hi: 'जानना', te: 'తెలుసు', es: 'Saber', fr: 'Savoir', de: 'Wissen', ta: 'தெரியும்' },
  'want': { hi: 'चाहना', te: 'కావాలి', es: 'Querer', fr: 'Vouloir', de: 'Wollen', ta: 'வேண்டும்' },
  'need': { hi: 'ज़रूरत', te: 'అవసరం', es: 'Necesitar', fr: 'Avoir besoin', de: 'Brauchen', ta: 'தேவை' },
  'work': { hi: 'काम', te: 'పని', es: 'Trabajo', fr: 'Travail', de: 'Arbeit', ta: 'வேலை' },
  'money': { hi: 'पैसा', te: 'డబ్బు', es: 'Dinero', fr: 'Argent', de: 'Geld', ta: 'பணம்' },
  'doctor': { hi: 'डॉक्टर', te: 'డాక్టర్', es: 'Doctor', fr: 'Médecin', de: 'Arzt', ta: 'மருத்துவர்' },
  'teacher': { hi: 'शिक्षक', te: 'ఉపాధ్యాయుడు', es: 'Profesor', fr: 'Professeur', de: 'Lehrer', ta: 'ஆசிரியர்' },
  'student': { hi: 'विद्यार्थी', te: 'విద్యార్థి', es: 'Estudiante', fr: 'Étudiant', de: 'Schüler', ta: 'மாணவர்' },
  'king': { hi: 'राजा', te: 'రాజు', es: 'Rey', fr: 'Roi', de: 'König', ta: 'மன்னன்' },
  'river': { hi: 'नदी', te: 'నది', es: 'Río', fr: 'Rivière', de: 'Fluss', ta: 'ஆறு' },
  'mountain': { hi: 'पहाड़', te: 'పర్వతం', es: 'Montaña', fr: 'Montagne', de: 'Berg', ta: 'மலை' },
  'tree': { hi: 'पेड़', te: 'చెట్టు', es: 'Árbol', fr: 'Arbre', de: 'Baum', ta: 'மரம்' },
  'flower': { hi: 'फूल', te: 'పువ్వు', es: 'Flor', fr: 'Fleur', de: 'Blume', ta: 'மலர்' },
  'bird': { hi: 'पक्षी', te: 'పక్షి', es: 'Pájaro', fr: 'Oiseau', de: 'Vogel', ta: 'பறவை' },
  'dog': { hi: 'कुत्ता', te: 'కుక్క', es: 'Perro', fr: 'Chien', de: 'Hund', ta: 'நாய்' },
  'cat': { hi: 'बिल्ली', te: 'పిల్లి', es: 'Gato', fr: 'Chat', de: 'Katze', ta: 'பூனை' },
  'night': { hi: 'रात', te: 'రాత్రి', es: 'Noche', fr: 'Nuit', de: 'Nacht', ta: 'இரவு' },
  'day': { hi: 'दिन', te: 'రోజు', es: 'Día', fr: 'Jour', de: 'Tag', ta: 'நாள்' },
  'morning': { hi: 'सुबह', te: 'ఉదయం', es: 'Mañana', fr: 'Matin', de: 'Morgen', ta: 'காலை' },
  'please help me': { hi: 'कृपया मेरी मदद कीजिए', te: 'దయచేసి నాకు సహాయం చేయండి', es: 'Por favor ayúdame', fr: "Aidez-moi s'il vous plaît", de: 'Bitte helfen Sie mir', ta: 'தயவுசெய்து எனக்கு உதவுங்கள்' },
  'i am fine': { hi: 'मैं ठीक हूँ', te: 'నేను బాగున్నాను', es: 'Estoy bien', fr: 'Je vais bien', de: 'Mir geht es gut', ta: 'நான் நன்றாக இருக்கிறேன்' },
  'where are you from': { hi: 'आप कहाँ से हैं?', te: 'మీరు ఎక్కడ నుండి వచ్చారు?', es: '¿De dónde eres?', fr: 'D\'où venez-vous?', de: 'Woher kommen Sie?', ta: 'நீங்கள் எங்கிருந்து வருகிறீர்கள்?' },
  'i am from india': { hi: 'मैं भारत से हूँ', te: 'నేను భారతదేశం నుండి వచ్చాను', es: 'Soy de India', fr: 'Je suis d\'Inde', de: 'Ich komme aus Indien', ta: 'நான் இந்தியாவில் இருந்து வந்தேன்' },
  'nice to meet you': { hi: 'आपसे मिलकर खुशी हुई', te: 'మిమ్మల్ని కలిసి ఆనందంగా ఉంది', es: 'Encantado de conocerte', fr: 'Enchanté de vous rencontrer', de: 'Freut mich, Sie kennenzulernen', ta: 'உங்களை சந்தித்ததில் மகிழ்ச்சி' },
  'happy birthday': { hi: 'जन्मदिन मुबारक', te: 'పుట్టినరోజు శుభాకాంక్షలు', es: 'Feliz cumpleaños', fr: 'Joyeux anniversaire', de: 'Alles Gute zum Geburtstag', ta: 'பிறந்தநாள் வாழ்த்துக்கள்' },
  'how old are you': { hi: 'आपकी उम्र क्या है?', te: 'మీ వయసు ఎంత?', es: '¿Cuántos años tienes?', fr: 'Quel âge avez-vous?', de: 'Wie alt sind Sie?', ta: 'உங்களுக்கு எவ்வளவு வயது?' },
  'i am a student': { hi: 'मैं एक विद्यार्थी हूँ', te: 'నేను విద్యార్థిని', es: 'Soy estudiante', fr: 'Je suis étudiant', de: 'Ich bin Student', ta: 'நான் ஒரு மாணவர்' },
  'what time is it': { hi: 'कितने बज रहे हैं?', te: 'ఇప్పుడు ఎంత సమయం?', es: '¿Qué hora es?', fr: 'Quelle heure est-il?', de: 'Wie spät ist es?', ta: 'இப்போது என்ன நேரம்?' },
  'i like food': { hi: 'मुझे खाना पसंद है', te: 'నాకు ఆహారం ఇష్టం', es: 'Me gusta la comida', fr: "J'aime la nourriture", de: 'Ich mag Essen', ta: 'எனக்கு உணவு பிடிக்கும்' },
  'biryani': { hi: 'बिरयानी', te: 'బిర్యానీ', es: 'Biryani', fr: 'Biryani', de: 'Biryani', ta: 'பிரியாணி' },
};

/* ── Word-level lexicon (for fallback) ── */
const WORD_LEXICON: Record<string, Record<string, string>> = {
  'i': { hi: 'मैं', te: 'నేను', es: 'Yo', fr: 'Je', de: 'Ich', ta: 'நான்' },
  'you': { hi: 'आप', te: 'మీరు', es: 'Tú', fr: 'Tu', de: 'Du', ta: 'நீங்கள்' },
  'we': { hi: 'हम', te: 'మేము', es: 'Nosotros', fr: 'Nous', de: 'Wir', ta: 'நாம்' },
  'they': { hi: 'वे', te: 'వారు', es: 'Ellos', fr: 'Ils', de: 'Sie', ta: 'அவர்கள்' },
  'he': { hi: 'वह', te: 'అతను', es: 'Él', fr: 'Il', de: 'Er', ta: 'அவன்' },
  'she': { hi: 'वह', te: 'ఆమె', es: 'Ella', fr: 'Elle', de: 'Sie', ta: 'அவள்' },
  'is': { hi: 'है', te: 'ఉంది', es: 'es', fr: 'est', de: 'ist', ta: 'இருக்கிறது' },
  'are': { hi: 'हैं', te: 'ఉన్నారు', es: 'son', fr: 'sont', de: 'sind', ta: 'இருக்கிறார்கள்' },
  'am': { hi: 'हूँ', te: 'ఉన్నాను', es: 'soy', fr: 'suis', de: 'bin', ta: 'இருக்கிறேன்' },
  'the': { hi: '', te: '', es: 'el', fr: 'le', de: 'der', ta: '' },
  'a': { hi: 'एक', te: 'ఒక', es: 'un', fr: 'un', de: 'ein', ta: 'ஒரு' },
  'this': { hi: 'यह', te: 'ఇది', es: 'esto', fr: 'ceci', de: 'dies', ta: 'இது' },
  'that': { hi: 'वह', te: 'అది', es: 'eso', fr: 'cela', de: 'das', ta: 'அது' },
  'and': { hi: 'और', te: 'మరియు', es: 'y', fr: 'et', de: 'und', ta: 'மற்றும்' },
  'or': { hi: 'या', te: 'లేదా', es: 'o', fr: 'ou', de: 'oder', ta: 'அல்லது' },
  'but': { hi: 'लेकिन', te: 'కానీ', es: 'pero', fr: 'mais', de: 'aber', ta: 'ஆனால்' },
  'not': { hi: 'नहीं', te: 'కాదు', es: 'no', fr: 'ne pas', de: 'nicht', ta: 'இல்லை' },
  'with': { hi: 'के साथ', te: 'తో', es: 'con', fr: 'avec', de: 'mit', ta: 'உடன்' },
  'in': { hi: 'में', te: 'లో', es: 'en', fr: 'dans', de: 'in', ta: 'இல்' },
  'on': { hi: 'पर', te: 'పై', es: 'en', fr: 'sur', de: 'auf', ta: 'மீது' },
  'at': { hi: 'पर', te: 'వద్ద', es: 'en', fr: 'à', de: 'bei', ta: 'இல்' },
  'to': { hi: 'को', te: 'కు', es: 'a', fr: 'à', de: 'zu', ta: 'க்கு' },
  'from': { hi: 'से', te: 'నుండి', es: 'de', fr: 'de', de: 'von', ta: 'இருந்து' },
  'for': { hi: 'के लिए', te: 'కోసం', es: 'para', fr: 'pour', de: 'für', ta: 'க்காக' },
  'very': { hi: 'बहुत', te: 'చాలా', es: 'muy', fr: 'très', de: 'sehr', ta: 'மிகவும்' },
  'new': { hi: 'नया', te: 'కొత్త', es: 'nuevo', fr: 'nouveau', de: 'neu', ta: 'புதிய' },
  'old': { hi: 'पुराना', te: 'పాత', es: 'viejo', fr: 'vieux', de: 'alt', ta: 'பழைய' },
  'man': { hi: 'आदमी', te: 'మనిషి', es: 'hombre', fr: 'homme', de: 'Mann', ta: 'ஆண்' },
  'woman': { hi: 'औरत', te: 'స్త్రీ', es: 'mujer', fr: 'femme', de: 'Frau', ta: 'பெண்' },
  'one': { hi: 'एक', te: 'ఒకటి', es: 'uno', fr: 'un', de: 'eins', ta: 'ஒன்று' },
  'two': { hi: 'दो', te: 'రెండు', es: 'dos', fr: 'deux', de: 'zwei', ta: 'இரண்டு' },
  'three': { hi: 'तीन', te: 'మూడు', es: 'tres', fr: 'trois', de: 'drei', ta: 'மூன்று' },
  'ten': { hi: 'दस', te: 'పది', es: 'diez', fr: 'dix', de: 'zehn', ta: 'பத்து' },
  'hundred': { hi: 'सौ', te: 'నూరు', es: 'cien', fr: 'cent', de: 'hundert', ta: 'நூறு' },
  'thousand': { hi: 'हज़ार', te: 'వెయ్యి', es: 'mil', fr: 'mille', de: 'tausend', ta: 'ஆயிரம்' },
};

export type TargetLang = 'hi' | 'te' | 'es' | 'fr' | 'de' | 'ta';

const LANG_NAMES: Record<TargetLang, string> = {
  hi: 'Hindi', te: 'Telugu', es: 'Spanish', fr: 'French', de: 'German', ta: 'Tamil',
};

function detectTargetLanguage(text: string): TargetLang | null {
  const lower = text.toLowerCase();
  if (/in\s+hindi|hindi\s+mein|हिंदी|to\s+hindi/i.test(lower)) return 'hi';
  if (/in\s+telugu|telugu\s+lo|తెలుగు|to\s+telugu/i.test(lower)) return 'te';
  if (/in\s+spanish|en\s+español|español|to\s+spanish/i.test(lower)) return 'es';
  if (/in\s+french|en\s+français|français|to\s+french/i.test(lower)) return 'fr';
  if (/in\s+german|auf\s+deutsch|deutsch|to\s+german/i.test(lower)) return 'de';
  if (/in\s+tamil|tamil\s+la|தமிழ்|to\s+tamil/i.test(lower)) return 'ta';
  return null;
}

function extractTextToTranslate(text: string): string {
  // Remove "translate ... to/in ..." wrapper
  let cleaned = text
    .replace(/translate\s+/i, '')
    .replace(/\s+(to|in|into|en|auf|mein|lo|la)\s+(hindi|telugu|spanish|french|german|tamil|español|français|deutsch|తెలుగు|हिंदी|தமிழ்)/i, '')
    .replace(/how\s+do\s+you\s+say\s+/i, '')
    .replace(/\s+in\s+(hindi|telugu|spanish|french|german|tamil)/i, '')
    .replace(/[?!]/g, '')
    .trim();
  return cleaned;
}

export function translateText(text: string): string {
  const targetLang = detectTargetLanguage(text);
  if (!targetLang) {
    return `I can translate between English and these languages:\n\n- **Hindi** (हिंदी) — say "translate [text] to Hindi"\n- **Telugu** (తెలుగు) — say "translate [text] to Telugu"\n- **Spanish** (Español) — say "translate [text] to Spanish"\n- **French** (Français) — say "translate [text] to French"\n- **German** (Deutsch) — say "translate [text] to German"\n- **Tamil** (தமிழ்) — say "translate [text] to Tamil"\n\nTry: "Translate hello to Hindi" or "How do you say thank you in Telugu"`;
  }

  const sourceText = extractTextToTranslate(text);
  const sourceLower = sourceText.toLowerCase().trim();

  // 1. Try exact phrase match
  for (const [phrase, translations] of Object.entries(PHRASE_MEMORY)) {
    if (sourceLower === phrase || sourceLower.includes(phrase)) {
      return `**"${sourceText}"** in ${LANG_NAMES[targetLang]}:\n\n## ${translations[targetLang]}\n\n*From phrase memory — common expressions.*`;
    }
  }

  // 2. Word-by-word translation
  const words = sourceLower.split(/\s+/);
  const translated: string[] = [];
  const unknown: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (WORD_LEXICON[clean]) {
      const t = WORD_LEXICON[clean][targetLang];
      translated.push(t || clean);
    } else if (PHRASE_MEMORY[clean]) {
      translated.push(PHRASE_MEMORY[clean][targetLang]);
    } else {
      translated.push(word);
      unknown.push(word);
    }
  }

  const result = translated.join(' ');

  let output = `**"${sourceText}"** in ${LANG_NAMES[targetLang]}:\n\n## ${result}`;
  if (unknown.length > 0) {
    output += `\n\n*Words left untranslated (not in lexicon): ${unknown.join(', ')}*`;
  }
  output += '\n\n*Translation uses phrase memory first, then word-level lexicon. For complex sentences, some nuance may be lost.*';

  return output;
}
