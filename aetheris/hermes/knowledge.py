"""Aetheris Hermes — the built-in offline knowledge base.

Ported from the Aurion C7 knowledge corpus so the unified runtime can ground
answers with zero network access. Consumed by the RECALL stage of the Hermes
cognition cascade and mirrored into the NOVA archival memory tier at boot.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KnowledgeArticle:
    """A single grounded article in the built-in corpus."""

    id: str
    title: str
    category: str
    content: str


KNOWLEDGE_BASE: tuple[KnowledgeArticle, ...] = (
    KnowledgeArticle(
        id='photosynthesis',
        title='Photosynthesis',
        category='science',
        content=(
            'Photosynthesis is the biological process by which green plants, algae, and certain bacteria '
            'convert light energy into chemical energy. The overall equation is: 6CO₂ + 6H₂O + light '
            'energy → C₆H₁₂O₆ + 6O₂. It occurs primarily in chloroplasts, specifically in the thylakoid '
            'membranes where chlorophyll absorbs light. The process has two stages: the light-dependent '
            'reactions (in thylakoids) which produce ATP and NADPH while splitting water to release O₂, '
            'and the Calvin cycle (in the stroma) which uses ATP and NADPH to fix CO₂ into glucose. '
            'Chlorophyll absorbs red and blue light, reflecting green. Factors affecting photosynthesis '
            'include light intensity, CO₂ concentration, temperature, and water availability. C4 plants '
            'like maize and sugarcane have a more efficient carbon fixation pathway than C3 plants. CAM '
            'plants (cacti, succulents) open stomata at night to conserve water.'
        ),
    ),
    KnowledgeArticle(
        id='gravity',
        title='Gravity',
        category='science',
        content=(
            "Gravity is the fundamental force of attraction between objects with mass. Newton's law of "
            "universal gravitation states F = G(m₁m₂)/r², where G = 6.674 × 10⁻¹¹ N⋅m²/kg². On Earth's "
            "surface, gravitational acceleration g ≈ 9.81 m/s². Einstein's General Relativity (1915) "
            'reinterpreted gravity as the curvature of spacetime caused by mass and energy. Key '
            'predictions include gravitational lensing, time dilation near massive objects, and '
            'gravitational waves (detected by LIGO in 2015). Escape velocity from Earth is about 11.2 '
            'km/s. Tidal forces arise from differential gravity. The gravitational binding energy of '
            'Earth is approximately 2.49 × 10³² joules. Weight = mass × g. In free fall, objects '
            'experience apparent weightlessness. Artificial gravity can be created through rotation '
            '(centripetal acceleration).'
        ),
    ),
    KnowledgeArticle(
        id='relativity',
        title='Theory of Relativity',
        category='science',
        content=(
            "Einstein's Special Relativity (1905) is built on two postulates: (1) the laws of physics are "
            'the same in all inertial frames, (2) the speed of light c = 3×10⁸ m/s is constant. Key '
            "consequences: time dilation (moving clocks run slower: t' = t/γ where γ = 1/√(1-v²/c²)), "
            "length contraction (L' = L/γ), mass-energy equivalence (E = mc²), and the relativity of "
            'simultaneity. General Relativity (1915) extends this to accelerating frames and gravity: '
            'mass-energy curves spacetime, and objects follow geodesics. The Einstein field equations '
            'relate spacetime curvature to the stress-energy tensor. Predictions confirmed: perihelion '
            'precession of Mercury, gravitational lensing, gravitational redshift, gravitational waves, '
            'black holes. GPS satellites must correct for both special and general relativistic effects.'
        ),
    ),
    KnowledgeArticle(
        id='quantum',
        title='Quantum Mechanics',
        category='science',
        content=(
            'Quantum mechanics describes the behavior of matter and energy at atomic and subatomic '
            'scales. Key principles: wave-particle duality (light and matter exhibit both wave and '
            'particle properties), quantization (energy comes in discrete packets called quanta), the '
            'Heisenberg uncertainty principle (ΔxΔp ≥ ℏ/2), and superposition (particles exist in '
            'multiple states until measured). The Schrödinger equation iℏ∂ψ/∂t = Ĥψ governs quantum '
            'evolution. The Born rule gives measurement probabilities |ψ|². Quantum entanglement links '
            'particles regardless of distance. Applications: semiconductors, lasers, MRI, quantum '
            'computing, quantum cryptography. The double-slit experiment demonstrates wave-particle '
            'duality. Quantum tunneling allows particles to pass through classically forbidden barriers. '
            'The Standard Model unifies electromagnetic, weak, and strong forces.'
        ),
    ),
    KnowledgeArticle(
        id='dna',
        title='DNA and Genetics',
        category='science',
        content=(
            'DNA (deoxyribonucleic acid) is the molecule that carries genetic instructions for life. It '
            "has a double helix structure discovered by Watson and Crick in 1953 (building on Franklin's "
            'X-ray data). DNA consists of nucleotides: a sugar (deoxyribose), a phosphate group, and a '
            'nitrogenous base (A, T, G, C). Base pairing rules: A-T and G-C (held by hydrogen bonds). '
            'Human DNA has ~3 billion base pairs and ~20,000-25,000 genes. DNA replication is '
            'semi-conservative. Transcription copies DNA to mRNA, translation uses mRNA with tRNA and '
            'ribosomes to build proteins (central dogma). The genetic code is triplet (codons of 3 '
            'bases). Mutations include point mutations, insertions, deletions. CRISPR-Cas9 enables '
            'precise gene editing. Mitochondrial DNA is inherited maternally. Epigenetics studies '
            'heritable changes in gene expression without DNA sequence changes.'
        ),
    ),
    KnowledgeArticle(
        id='climate',
        title='Climate Change',
        category='science',
        content=(
            'Climate change refers to long-term shifts in global temperatures and weather patterns. Since '
            'the Industrial Revolution, human activities (primarily burning fossil fuels) have increased '
            'atmospheric CO₂ from ~280 ppm to over 420 ppm. The greenhouse effect: CO₂, methane, and '
            'other gases trap infrared radiation, warming Earth. Global average temperature has risen '
            '~1.1°C since pre-industrial times. Consequences: melting ice sheets, rising sea levels '
            '(~20cm since 1900), more extreme weather, ocean acidification, biodiversity loss. The Paris '
            'Agreement (2015) aims to limit warming to 1.5-2°C. Mitigation strategies: renewable energy, '
            'electric vehicles, carbon capture, reforestation, reduced meat consumption. India is highly '
            'vulnerable due to monsoon dependence, coastal populations, and heat stress. Solar and wind '
            'energy costs have dropped 85-90% since 2010.'
        ),
    ),
    KnowledgeArticle(
        id='internet',
        title='The Internet',
        category='science',
        content=(
            'The Internet is a global network of interconnected computer networks using the TCP/IP '
            'protocol suite. It originated from ARPANET (1969, funded by US DoD). Tim Berners-Lee '
            'invented the World Wide Web in 1989 at CERN. Key protocols: TCP (transmission control), IP '
            '(internet protocol), HTTP/HTTPS (web), DNS (domain name resolution), SMTP (email), FTP (file '
            'transfer). IPv4 uses 32-bit addresses (~4.3 billion), IPv6 uses 128-bit addresses. The '
            'Internet works through routers forwarding packets, ISPs connecting users, and undersea '
            'cables spanning oceans. ICANN governs domain names. Bandwidth is measured in bits per '
            'second. The Internet has ~5 billion users (2024). Key technologies: fiber optics, 5G, WiFi, '
            'cloud computing, CDNs. Net neutrality debates center on equal treatment of internet traffic.'
        ),
    ),
    KnowledgeArticle(
        id='computers',
        title='Computer Science Fundamentals',
        category='science',
        content=(
            'Computer science studies computation, algorithms, and information. A computer has hardware '
            '(CPU, RAM, storage, I/O) and software (OS, applications). Binary (0s and 1s) is the '
            'fundamental representation. CPU executes instructions in fetch-decode-execute cycle. RAM is '
            'volatile, storage (SSD/HDD) is persistent. Operating systems manage processes, memory, file '
            'systems, and I/O. Algorithms have time complexity measured in Big-O notation: O(1), O(log '
            'n), O(n), O(n log n), O(n²), O(2ⁿ). Data structures: arrays, linked lists, stacks, queues, '
            'hash tables, trees, graphs, heaps. Programming paradigms: imperative, functional, '
            'object-oriented, declarative. Networking: LAN, WAN, OSI model (7 layers). Databases: '
            'relational (SQL) vs NoSQL. Compilers translate high-level code to machine code. Turing '
            'machines formalize computation. P vs NP is an open problem.'
        ),
    ),
    KnowledgeArticle(
        id='ml',
        title='Machine Learning',
        category='science',
        content=(
            'Machine learning is a subset of AI where systems learn patterns from data without explicit '
            'programming. Types: supervised learning (classification, regression with labeled data), '
            'unsupervised learning (clustering, dimensionality reduction), reinforcement learning '
            '(reward-based). Key algorithms: linear regression, logistic regression, decision trees, '
            'random forests, k-nearest neighbors, support vector machines, naive Bayes, k-means '
            'clustering, neural networks. Deep learning uses multi-layer neural networks. Training '
            'involves minimizing a loss function via gradient descent. Overfitting is mitigated by '
            'regularization, cross-validation, dropout. Evaluation metrics: accuracy, precision, recall, '
            'F1-score, AUC-ROC. Feature engineering transforms raw data into useful inputs. Transformers '
            '(2017) revolutionized NLP with self-attention. CNNs excel at image tasks. Transfer learning '
            'reuses pre-trained models. Bias and fairness are critical ethical concerns.'
        ),
    ),
    KnowledgeArticle(
        id='python',
        title='Python Programming',
        category='programming',
        content=(
            'Python is a high-level, interpreted, dynamically-typed programming language created by Guido '
            'van Rossum (1991). Known for readability and simplicity. Uses indentation for blocks. Key '
            'features: first-class functions, generators, decorators, list comprehensions, f-strings, '
            'type hints (3.5+), async/await. Standard library: os, sys, json, re, datetime, collections, '
            'itertools, functools, pathlib. Package manager: pip. Virtual environments: venv, conda. Web '
            'frameworks: Django, Flask, FastAPI. Data science: NumPy, Pandas, Matplotlib, scikit-learn. '
            'Python 3 is current (Python 2 EOL 2020). GIL (Global Interpreter Lock) limits true threading '
            'for CPU-bound tasks. Multiprocessing and asyncio address concurrency. PEP 8 is the style '
            'guide. Common patterns: context managers (with statement), dataclasses, enum, typing module.'
        ),
    ),
    KnowledgeArticle(
        id='javascript',
        title='JavaScript and React',
        category='programming',
        content=(
            'JavaScript is the language of the web, running in browsers and Node.js. ES6+ features: '
            'let/const, arrow functions, template literals, destructuring, spread/rest, classes, modules, '
            'Promises, async/await, Map/Set, optional chaining, nullish coalescing. TypeScript adds '
            'static typing. DOM manipulation, event handling, fetch API, localStorage. React is a UI '
            'library by Meta using components (function components with hooks). Key hooks: useState, '
            'useEffect, useContext, useRef, useMemo, useCallback, useReducer. JSX combines HTML with JS. '
            'Virtual DOM enables efficient rendering. State management: Context API, Redux, Zustand, '
            'Jotai. Next.js adds SSR, SSG, API routes, file-based routing. Styling: CSS modules, '
            'Tailwind, styled-components. Testing: Jest, React Testing Library, Cypress. Package '
            'managers: npm, yarn, pnpm. Build tools: Vite, webpack, Turbopack.'
        ),
    ),
    KnowledgeArticle(
        id='java',
        title='Java Programming',
        category='programming',
        content=(
            'Java is a class-based, object-oriented language designed for portability (WORA — Write Once, '
            'Run Anywhere). Runs on the JVM. Strongly typed. Key concepts: classes, objects, inheritance, '
            'polymorphism, encapsulation, abstraction, interfaces, abstract classes. Java 8+ features: '
            'lambdas, streams, Optional, functional interfaces. Collections framework: List, Set, Map, '
            'Queue. Exception handling: try-catch-finally, checked vs unchecked. Multithreading: Thread, '
            'Runnable, ExecutorService, CompletableFuture. Build tools: Maven, Gradle. Frameworks: Spring '
            'Boot (web, microservices), Hibernate (ORM). Android development historically used Java. '
            'Memory management via garbage collection. JVM optimizes with JIT compilation. Records (Java '
            '16), sealed classes (Java 17), pattern matching. Java is widely used in enterprise, banking, '
            'and Android.'
        ),
    ),
    KnowledgeArticle(
        id='cpp',
        title='C++ Programming',
        category='programming',
        content=(
            'C++ is a high-performance, general-purpose language extending C with OOP features. Created '
            'by Bjarne Stroustrup (1979). Key features: classes, templates, operator overloading, RAII, '
            'smart pointers, move semantics. STL (Standard Template Library): vectors, maps, sets, '
            'algorithms, iterators. Memory management: new/delete, stack vs heap. Modern C++ '
            '(11/14/17/20/23): auto, range-for, lambda expressions, constexpr, concepts, ranges, '
            'coroutines, modules. Compile-time computation with templates and constexpr. Zero-cost '
            'abstractions. Used in game engines, OS kernels, embedded systems, high-frequency trading, '
            'compilers. Undefined behavior is a major concern. Rule of Three/Five/Zero for resource '
            'management. Common pitfalls: dangling pointers, memory leaks, buffer overflows. Build '
            'systems: CMake, Make. Compilers: GCC, Clang, MSVC.'
        ),
    ),
    KnowledgeArticle(
        id='sql',
        title='SQL and Databases',
        category='programming',
        content=(
            'SQL (Structured Query Language) manages relational databases. Core operations: SELECT, '
            'INSERT, UPDATE, DELETE. JOIN types: INNER, LEFT, RIGHT, FULL, CROSS. Aggregate functions: '
            'COUNT, SUM, AVG, MIN, MAX with GROUP BY and HAVING. Subqueries, CTEs (WITH clause), window '
            'functions (ROW_NUMBER, RANK, LAG, LEAD, PARTITION BY). Indexes speed up queries (B-tree, '
            'hash, GIN, GiST). ACID properties: Atomicity, Consistency, Isolation, Durability. '
            'Normalization (1NF, 2NF, 3NF, BCNF) reduces redundancy. Transaction isolation levels: Read '
            'Uncommitted, Read Committed, Repeatable Read, Serializable. Databases: PostgreSQL, MySQL, '
            'SQLite, MariaDB, Oracle, SQL Server. NoSQL alternatives: MongoDB (document), Redis '
            '(key-value), Cassandra (wide-column), Neo4j (graph). Explain plans help optimize slow '
            'queries. Stored procedures, triggers, views.'
        ),
    ),
    KnowledgeArticle(
        id='html-css',
        title='HTML and CSS',
        category='programming',
        content=(
            'HTML (HyperText Markup Language) structures web content. Semantic elements: header, nav, '
            'main, article, section, aside, footer. HTML5 added: canvas, video, audio, svg, form '
            'validations, WebSockets, Web Workers, Service Workers, localStorage/sessionStorage. CSS '
            'styles web pages. Layout: Flexbox (1D), CSS Grid (2D), float (legacy). Selectors: class, ID, '
            'attribute, pseudo-classes (:hover, :nth-child), combinators (>, ~, +). Box model: margin, '
            'border, padding, content. Responsive design: media queries, viewport units, clamp(), '
            'container queries. CSS variables (--custom-properties). Preprocessors: Sass, Less. '
            'Animations: @keyframes, transitions. Modern CSS: :has(), subgrid, nesting, cascade layers, '
            'color-mix(), oklch(). Accessibility: ARIA roles, semantic HTML, focus management, contrast '
            'ratios. Performance: critical CSS, lazy loading, font-display, will-change.'
        ),
    ),
    KnowledgeArticle(
        id='git',
        title='Git Version Control',
        category='programming',
        content=(
            'Git is a distributed version control system created by Linus Torvalds (2005). Core concepts: '
            'repository, commit, branch, merge, rebase, remote. Commands: git init, clone, add, commit, '
            'push, pull, fetch, status, log, diff, branch, checkout/switch, merge, rebase, stash, reset, '
            'revert, cherry-pick. Branching strategies: Git Flow (feature/develop/release/main), GitHub '
            'Flow (feature/main), trunk-based. Merge vs rebase: merge preserves history, rebase creates '
            'linear history. Conflict resolution: manual editing after merge conflict markers. Tags: '
            'lightweight and annotated. Git stores snapshots, not diffs. Internally uses SHA-1 hashes, '
            'trees, blobs, commits. .gitignore excludes files. GitHub/GitLab add PRs, issues, CI/CD, code '
            'review. Bisect finds bug-introducing commits. Hooks automate workflows. Submodules link '
            'external repos.'
        ),
    ),
    KnowledgeArticle(
        id='http',
        title='HTTP and Web Protocols',
        category='programming',
        content=(
            'HTTP (HyperText Transfer Protocol) is the foundation of web communication. Request methods: '
            'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. Status codes: 1xx (informational), 2xx '
            '(success: 200 OK, 201 Created), 3xx (redirect: 301, 302, 304), 4xx (client error: 400 Bad '
            'Request, 401 Unauthorized, 403 Forbidden, 404 Not Found), 5xx (server error: 500 Internal '
            'Server Error). Headers: Content-Type, Authorization, Cookie, Cache-Control, CORS headers. '
            'HTTPS encrypts with TLS/SSL. HTTP/2 added multiplexing and header compression. HTTP/3 uses '
            'QUIC (UDP-based). REST architecture uses HTTP methods for CRUD operations. GraphQL provides '
            'flexible querying. WebSockets enable bidirectional communication. CORS policy restricts '
            'cross-origin requests. Cookies, sessions, JWT tokens manage authentication. CDN caches '
            'static content globally. DNS resolves domain names to IP addresses.'
        ),
    ),
    KnowledgeArticle(
        id='security',
        title='Cybersecurity Fundamentals',
        category='programming',
        content=(
            'Cybersecurity protects systems from digital attacks. Common threats: SQL injection '
            '(parameterized queries prevent), XSS (sanitize input, CSP headers), CSRF (tokens), phishing, '
            'ransomware, DDoS, man-in-the-middle. Authentication vs authorization. Hashing (bcrypt, '
            'argon2) for passwords, never store plaintext. Encryption: symmetric (AES) and asymmetric '
            '(RSA, ECC). OWASP Top 10 documents critical web vulnerabilities. HTTPS/TLS encrypts data in '
            'transit. JWT tokens: sign, verify, expire. Rate limiting prevents brute force. Input '
            'validation and sanitization. Security headers: X-Content-Type-Options, X-Frame-Options, '
            'Strict-Transport-Security, Content-Security-Policy. Principle of least privilege. Zero trust '
            'architecture. Multi-factor authentication (MFA). Penetration testing and vulnerability '
            'scanning. Security audits and compliance (SOC 2, GDPR). Defense in depth.'
        ),
    ),
    KnowledgeArticle(
        id='india',
        title='India',
        category='geography',
        content=(
            "India (officially Republic of India) is the world's most populous country (1.4+ billion) and "
            '7th largest by area (3.287 million km²). Capital: New Delhi. Largest city: Mumbai. 28 states '
            'and 8 union territories. Official languages: Hindi and English (plus 22 scheduled '
            'languages). Currency: Indian Rupee (₹). Parliament: Lok Sabha (lower) and Rajya Sabha '
            '(upper). Independence: August 15, 1947 from British rule. Constitution adopted January 26, '
            '1950 (largest written constitution). GDP: ~$3.7 trillion (5th largest economy). Major '
            'industries: IT services, agriculture, textiles, pharmaceuticals, automotive. Space program: '
            'ISRO (Chandrayaan, Mangalyaan/Mars Orbiter). Major rivers: Ganga, Yamuna, Brahmaputra, '
            'Godavari, Krishna, Narmada. Himalayas in the north, Deccan Plateau in the south. Diverse '
            'climate: tropical, arid, temperate, alpine. Cricket is the most popular sport. Bollywood is '
            'the largest film industry by output.'
        ),
    ),
    KnowledgeArticle(
        id='hyderabad',
        title='Hyderabad',
        category='geography',
        content=(
            'Hyderabad is the capital of Telangana, India, with a metropolitan population of ~10 million. '
            'Founded in 1591 by Muhammad Quli Qutb Shah. Known as the City of Pearls and Cyberabad. Major '
            'landmarks: Charminar (1591), Golconda Fort, Hussain Sagar Lake, Salar Jung Museum, Birla '
            "Mandir, Ramoji Film City (world's largest film studio complex). IT hub: HITEC City, Genome "
            'Valley, Financial District. Companies with offices: Google, Microsoft, Amazon, Apple, '
            'Facebook, Infosys, TCS, Wipro. Famous cuisine: Hyderabadi biryani (dum style), haleem, '
            'double ka meetha, qubani ka meetha, irani chai, osmania biscuits. Languages: Telugu, Urdu, '
            "Hindi, English. Metro: Hyderabad Metro Rail (India's longest metro project in PPP mode). "
            'Universities: University of Hyderabad, Osmania University, IIIT Hyderabad, ISB, IIT '
            'Hyderabad. Pearls and lacquer bangles from Laad Bazaar. Climate: hot semi-arid. IT exports: '
            'over ₹1.5 lakh crore annually.'
        ),
    ),
    KnowledgeArticle(
        id='telangana',
        title='Telangana',
        category='geography',
        content=(
            'Telangana is the 29th state of India, formed on June 2, 2014, carved from Andhra Pradesh. '
            'Capital: Hyderabad. Area: 112,077 km². Population: ~35 million. Districts: 33. Language: '
            'Telugu (primary), Urdu. Chief Minister leads the state government. Governor is the '
            'constitutional head. Legislature: unicameral (Legislative Assembly, 119 seats). Major '
            'rivers: Godavari, Krishna, Musi, Manjeera. Agriculture: rice (paddy), cotton, maize, '
            'sugarcane, turmeric, red chili. IT and pharma are major industries. Kakatiya dynasty ruled '
            'this region (12th-14th century). The Telangana movement for separate statehood spanned '
            'decades, with major agitation in 2009-2014. Warangal is the second-largest city. Basara is '
            "famous for Saraswati temple. Kaleshwaram Lift Irrigation Project is one of the world's "
            'largest. Bathukamma is a famous floral festival. Bonalu is celebrated in Hyderabad. Ramappa '
            'Temple (UNESCO World Heritage Site) is in Warangal district.'
        ),
    ),
    KnowledgeArticle(
        id='mughals',
        title='Mughal Empire',
        category='history',
        content=(
            'The Mughal Empire (1526-1857) was one of the most powerful empires in Indian history. '
            'Founded by Babur after the First Battle of Panipat (1526) against Ibrahim Lodi. Notable '
            'emperors: Babur (1526-1530), Humayun (1530-1540, 1555-1556), Akbar the Great (1556-1605), '
            'Jahangir (1605-1627), Shah Jahan (1628-1658), Aurangzeb (1658-1707). Akbar established '
            'Din-i-Ilahi, abolished jizya tax, and promoted religious tolerance. Shah Jahan built the Taj '
            'Mahal, Red Fort, and Jama Masjid. The empire reached its greatest extent under Aurangzeb. '
            'Mughal architecture blended Islamic, Persian, and Indian styles. Decline began after '
            'Aurangzeb due to wars, Maratha resistance, and later British colonial expansion. The last '
            'Mughal emperor was Bahadur Shah Zafar, exiled after the 1857 revolt. Mughal legacy: art, '
            'architecture, cuisine (biryani, kebabs, naan), miniature paintings, Urdu language.'
        ),
    ),
    KnowledgeArticle(
        id='independence',
        title='Indian Independence Movement',
        category='history',
        content=(
            "India's independence movement spanned nearly a century of struggle against British colonial "
            'rule. Key events: Revolt of 1857 (First War of Independence), formation of Indian National '
            'Congress (1885), Partition of Bengal (1905), Swadeshi movement, Jallianwala Bagh massacre '
            '(1919), Non-Cooperation Movement (1920-22), Civil Disobedience Movement (1930, Salt March), '
            'Quit India Movement (1942). Key leaders: Mahatma Gandhi (non-violence, satyagraha), '
            'Jawaharlal Nehru, Subhas Chandra Bose (Indian National Army), Sardar Patel (integration of '
            'princely states), Bhagat Singh, B.R. Ambedkar (Constitution architect), Maulana Azad, '
            'Sarojini Naidu. India gained independence on August 15, 1947, but was partitioned into India '
            'and Pakistan, causing massive displacement and violence (~1-2 million deaths). Constitution '
            'came into effect January 26, 1950 (Republic Day).'
        ),
    ),
    KnowledgeArticle(
        id='blackholes',
        title='Black Holes',
        category='science',
        content=(
            'A black hole is a region of spacetime where gravity is so strong that nothing, not even '
            'light, can escape. Formed when massive stars (>20 solar masses) collapse at end of life. '
            'Types: stellar (3-100 solar masses), intermediate (100-100,000), supermassive (millions to '
            'billions, at galaxy centers). The event horizon is the boundary; the singularity is the '
            'center of infinite density. Schwarzschild radius: r = 2GM/c². Hawking radiation predicts '
            'black holes slowly evaporate. Time dilation near event horizon. The first image of a black '
            'hole (M87*) was captured by the Event Horizon Telescope in 2019. Sagittarius A* is the '
            "supermassive black hole at Milky Way's center (~4 million solar masses). Black holes merge "
            'producing gravitational waves. Information paradox: what happens to information that falls '
            'in? No-hair theorem: black holes are described by mass, charge, and spin only.'
        ),
    ),
    KnowledgeArticle(
        id='solarsystem',
        title='Solar System',
        category='science',
        content=(
            'Our solar system consists of the Sun and everything bound by its gravity: 8 planets, dwarf '
            'planets, moons, asteroids, and comets. Planets in order: Mercury, Venus, Earth, Mars, '
            'Jupiter, Saturn, Uranus, Neptune. Inner planets (rocky): Mercury (smallest, no atmosphere), '
            'Venus (hottest, thick CO₂), Earth (life, liquid water), Mars (red, thin atmosphere, Olympus '
            'Mons). Outer planets (gas/ice giants): Jupiter (largest, Great Red Spot, 79+ moons), Saturn '
            '(rings, Titan), Uranus (tilted 98°, ice giant), Neptune (windiest). The Sun contains 99.86% '
            'of solar system mass. The asteroid belt is between Mars and Jupiter. The Kuiper Belt and '
            "Oort Cloud are beyond Neptune. Dwarf planets: Pluto, Eris, Ceres, Haumea, Makemake. Earth's "
            'Moon formed from a giant impact. The solar system is ~4.6 billion years old and located in '
            'the Orion Arm of the Milky Way.'
        ),
    ),
    KnowledgeArticle(
        id='nutrition',
        title='Nutrition and Diet',
        category='health',
        content=(
            'Nutrition is the science of how food affects health. Macronutrients: carbohydrates (4 cal/g, '
            'primary energy), proteins (4 cal/g, building/repair), fats (9 cal/g, energy storage, '
            'hormones). Micronutrients: vitamins (A, B-complex, C, D, E, K) and minerals (iron, calcium, '
            'zinc, potassium, magnesium). Recommended daily calories: ~2000 for women, ~2500 for men '
            '(varies by activity). Water: 2-3 liters daily. Fiber: 25-30g daily for digestive health. '
            'Superfoods: berries, leafy greens, nuts, fatty fish, turmeric, garlic. Indian diet '
            'strengths: dal (protein), roti (complex carbs), ghee (healthy fats in moderation), spices '
            'with anti-inflammatory properties. Deficiencies: iron (anemia), vitamin D (bone health), B12 '
            '(common in vegetarians). Processed foods, excess sugar, and trans fats increase disease '
            'risk. Mediterranean and plant-based diets show strongest health outcomes. This is '
            'educational information, not medical advice.'
        ),
    ),
    KnowledgeArticle(
        id='economics',
        title='Economics',
        category='social',
        content=(
            'Economics studies how societies allocate scarce resources. Microeconomics: supply and '
            'demand, market equilibrium, elasticity, consumer/producer surplus, market structures '
            '(perfect competition, monopoly, oligopoly). Macroeconomics: GDP, inflation, unemployment, '
            'fiscal policy (government spending/taxation), monetary policy (interest rates, money '
            'supply). GDP = C + I + G + (X-M). Inflation measured by CPI and WPI. Central banks control '
            'monetary policy (RBI in India, Federal Reserve in US). Types: capitalism, socialism, mixed '
            "economies. India's economy: 5th largest GDP (~$3.7T), agriculture employs ~42% but "
            'contributes ~18% GDP. Major reforms: liberalization (1991), GST (2017), demonetization '
            '(2016). Budget deficit, current account deficit, forex reserves. Behavioral economics '
            'studies psychological factors. Game theory analyzes strategic decisions. Gini coefficient '
            'measures income inequality.'
        ),
    ),
    KnowledgeArticle(
        id='startups',
        title='Startups and Entrepreneurship',
        category='business',
        content=(
            'A startup is a temporary organization designed to search for a repeatable and scalable '
            'business model. Key concepts: MVP (Minimum Viable Product), product-market fit, pivot, lean '
            'methodology, design thinking. Funding stages: bootstrapping, angel investors, seed, Series '
            'A/B/C, IPO. Indian startup ecosystem: 3rd largest globally with 100,000+ DPIIT-recognized '
            "startups. Unicorn valuation: $1 billion+. Indian unicorns: Flipkart, BYJU'S, Ola, Paytm, "
            'Zomato, Swiggy, Razorpay, Zerodha, CRED. Startup India initiative (2016) provides tax '
            'benefits, funding support. Key metrics: MRR/ARR, CAC, LTV, churn rate, burn rate, runway. Y '
            'Combinator, Techstars are top accelerators. Common mistakes: building without validation, '
            'premature scaling, co-founder conflicts, ignoring unit economics. Pivot examples: Slack '
            '(from gaming), YouTube (from dating), Instagram (from Burbn).'
        ),
    ),
    KnowledgeArticle(
        id='writing',
        title='Writing Guide',
        category='writing',
        content=(
            'Effective writing principles: clarity (simple language, avoid jargon), conciseness (remove '
            'unnecessary words), structure (logical flow with intro-body-conclusion), active voice '
            'preferred over passive. Email format: subject line (specific, concise), greeting, context, '
            'main message, call to action, signature. Blog writing: hook in first paragraph, subheadings '
            'for scannability, short paragraphs (3-4 sentences), images, bullet points, conclusion with '
            'takeaway. Resume writing: one page for <10 years experience, reverse chronological, action '
            'verbs (led, built, achieved, optimized), quantify results, tailor to job description. Formal '
            'letter: sender address, date, recipient address, subject, salutation, body, closing, '
            'signature. Cover letter: 3-4 paragraphs — opening (position + enthusiasm), body (relevant '
            'experience + achievements), closing (call to action). Social media: platform-appropriate '
            'tone, hashtags (2-5 for LinkedIn, 1-3 for Twitter), engagement hooks, visual content.'
        ),
    ),
    KnowledgeArticle(
        id='jee-study',
        title='JEE Study Method',
        category='education',
        content=(
            'JEE (Joint Entrance Examination) has two levels: JEE Main (for NITs, IIITs) and JEE Advanced '
            '(for IITs). Subjects: Physics, Chemistry, Mathematics. Study method: (1) Master NCERT '
            'textbooks first — they build the foundation. (2) Solve previous year questions (PYQs) '
            'topic-wise. (3) Build a formula sheet per chapter. (4) Practice daily: at least 30 problems '
            'per subject. (5) Weekly full-length mock tests under timed conditions. (6) Analyze mistakes '
            '— maintain an error log. (7) Revision: spaced repetition, revise weak topics more '
            'frequently. Physics key topics: Mechanics, Electrodynamics, Optics, Modern Physics, '
            'Thermodynamics. Chemistry: Physical (equilibrium, thermodynamics), Organic (reactions, '
            'mechanisms), Inorganic (periodic table, coordination compounds). Math: Calculus, Coordinate '
            'Geometry, Algebra, Trigonometry, Probability. Time management: 2 minutes per question max in '
            'exam. Solve easy questions first, then medium, skip hard ones initially. Consistency beats '
            'intensity — 6-8 hours daily for 1-2 years. Stay healthy: sleep 7-8 hours, exercise, eat '
            'well.'
        ),
    ),
    KnowledgeArticle(
        id='aurion',
        title='About AURION',
        category='meta',
        content=(
            'AURION is a sovereign cognitive engine that runs entirely on your device. It is powered by '
            'the C7 cascade — a proprietary 7-stage pipeline: SENSE (tokenization, language detection, '
            'entity extraction, sentiment analysis), ALIGN (hybrid intent classification using cue '
            'patterns and TF-IDF cosine similarity), PLOT (task-graph planning with style selection), '
            'RECALL (BM25 search over built-in knowledge base and session memory), THINK '
            '(recursive-descent math parser with unit conversions and statistics), WEAVE (compositional '
            'generators for each intent type), and REFINE (safety filtering, persona polish, honesty '
            'enforcement). AURION does NOT use OpenAI, Anthropic Claude, Google Gemini, Groq, xAI, or any '
            'third-party AI API. All processing happens locally. No data leaves your device. No API keys '
            'required. Your prompts, files, and conversation history are stored in browser localStorage '
            'only. AURION can chat, write emails/blogs/stories/poems, generate code, explain concepts, '
            'solve math, translate languages, create images (via Visage canvas renderer), and more. Built '
            'with Next.js, TypeScript, and Tailwind CSS.'
        ),
    ),
)


KB_BY_ID: dict[str, KnowledgeArticle] = {a.id: a for a in KNOWLEDGE_BASE}

CATEGORIES: tuple[str, ...] = tuple(sorted({a.category for a in KNOWLEDGE_BASE}))


__all__ = ["KnowledgeArticle", "KNOWLEDGE_BASE", "KB_BY_ID", "CATEGORIES"]
