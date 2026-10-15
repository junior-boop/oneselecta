import { ModelFactory, SimpleORM, type D1Database } from "../utils/simpleorm";

// ─── Utilisateurs / Auth ─────────────────────────────────────────────

export type User = {
    id: string;
    email: string;
    passwordHash: string;
    nom: string;
    prenom: string;
    telephone?: string;
    role: "super_admin" | "admin" | "gestionnaire" | "vendeur";
    statut: "actif" | "inactif" | "archivé";
    createdAt: string;
    updatedAt: string;
    derniereConnexion?: string;
};

// ─── Journal de synchronisation ──────────────────────────────────────

export type SyncJournal = {
    id: string;
    operation: "create" | "update" | "delete";
    id_element: string;
    table_name: string;
    timestamp: string;
    client_id: string;
    user_id: string;
    data: string | null;
};

// ─── Entités métier ──────────────────────────────────────────────────

export type Administrateur = {
    id: string;
    nom: string;
    prenom: string;
    email: string;
    telephone?: string;
    role: string;
    motDePasseHash: string;
    avatar?: string;
    statut: string;
    createdAt: string;
    updatedAt: string;
    derniereConnexion?: string;
};

export type Client = {
    id: string;
    type: string;
    nom: string;
    prenom?: string;
    raisonSociale?: string;
    email: string;
    telephone: string;
    telephone2?: string;
    adresse: string;
    statut: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
};

export type Collection = {
    id: string;
    nom: string;
    description?: string;
    ordre?: number;
    statut: string;
    quantite: number;
    createdAt: string;
    updatedAt: string;
};

export type SousCollection = {
    id: string;
    collectionId: string;
    nom: string;
    description?: string;
    image?: string;
    ordre?: number;
    statut: string;
    createdAt: string;
    updatedAt: string;
};

export type Article = {
    id: string;
    collectionId: string;
    sousCollectionId?: string;
    nom: string;
    description?: string;
    reference: string;
    unite: string;
    prixHT: number;
    tauxTVA: number;
    prixTTC: number;
    dimensions?: string;
    images: string;
    stockTotal: number;
    statut: string;
    prive: number;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
};

export type Devis = {
    id: string;
    numero: string;
    clientId: string;
    lignes: string;
    groupes?: string;
    totalHT: number;
    totalTVA: number;
    totalTTC: number;
    afficherTVA: number;
    afficherTVALignes: number;
    remiseGlobale: number;
    totalApreRemise: number;
    statut: string;
    dateEmission: string;
    dateValidite: string;
    dateAcceptation?: string;
    notes?: string;
    conditionsPaiement?: string;
    envois?: string;
    factureId?: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
};

export type Facture = {
    id: string;
    numero: string;
    clientId: string;
    devisId?: string;
    lignes: string;
    groupes?: string;
    totalHT: number;
    totalTVA: number;
    totalTTC: number;
    afficherTVA: number;
    afficherTVALignes: number;
    remiseGlobale: number;
    totalApreRemise: number;
    montantPayé: number;
    montantRestant: number;
    paiements: string;
    statut: string;
    dateEmission: string;
    dateEcheance: string;
    datePaiementComplet?: string;
    notes?: string;
    conditionsPaiement?: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
};

export type LigneDocument = {
    id: string;
    documentId: string;
    documentType: string;
    articleId: string;
    varianteId?: string;
    designation: string;
    reference: string;
    quantite: number;
    unite: string;
    prixUnitaireHT: number;
    tauxTVA: number;
    prixUnitaireTTC: number;
    montantTotalHT: number;
    montantTotalTTC: number;
    remise: number;
    notes?: string;
    groupeId?: string;
    sousGroupeId?: string;
};

export type Technicien = {
    id: string;
    nom: string;
    prenom: string;
    telephone: string;
    email?: string;
    specialite?: string;
    statut: string;
    createdAt: string;
    updatedAt: string;
};

export type Projet = {
    id: string;
    nom: string;
    description?: string;
    clientId: string;
    adresse?: string;
    statut: string;
    dateDebut: string;
    dateFin?: string;
    dateFinReelle?: string;
    devisIds: string;
    technicienIds: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
};

export type Boutique = {
    id: string;
    nom: string;
    adresse?: string;
    userId?: string;
    isPrincipal: number;
    statut: string;
    createdAt: string;
    updatedAt: string;
};

export type StockBoutique = {
    id: string;
    boutiqueId: string;
    articleId: string;
    varianteId?: string;
    quantite: number;
    updatedAt: string;
};

export type TransfertStock = {
    id: string;
    articleId: string;
    varianteId?: string;
    boutiqueSourceId?: string;
    boutiqueDestId?: string;
    quantite: number;
    sens: string;
    userId: string;
    note?: string;
    createdAt: string;
};

export type TacheProjet = {
    id: string;
    projetId: string;
    titre: string;
    description?: string;
    statut: string;
    priorite: string;
    technicienIds: string;
    dateDebut?: string;
    dateEcheance?: string;
    ordre: number;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
};

export type Entreprise = {
    id: string;
    matricule: string;
    nom: string;
    adresse: string;
    telephone: string;
    email: string;
    logoDataUrl: string;
    notesDevis: string;
    notesFacture: string;
    conditionsPaiement: string;
    setupDone: number;
    customFields: string;
    devisPrefix: string;
    facturePrefix: string;
    numeroFormat: string;
    tvaDefault: number;
    devise: string;
    afficherTVA: number;
};

// ─── Factory ─────────────────────────────────────────────────────────

export function buildModels(db: D1Database) {
    const orm = new SimpleORM(db);
    const f = new ModelFactory(orm);

    return {
        orm,
        Users: f.createModel<User>("users", {
            id: "TEXT PRIMARY KEY NOT NULL",
            email: "TEXT NOT NULL UNIQUE",
            passwordHash: "TEXT NOT NULL",
            nom: "TEXT NOT NULL",
            prenom: "TEXT NOT NULL",
            telephone: "TEXT",
            role: "TEXT NOT NULL",
            statut: "TEXT NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            derniereConnexion: "TEXT",
        }),
        SyncJournal: f.createModel<SyncJournal>("sync_journal", {
            id: "TEXT PRIMARY KEY NOT NULL",
            operation: "TEXT NOT NULL",
            id_element: "TEXT NOT NULL",
            table_name: "TEXT NOT NULL",
            timestamp: "TEXT NOT NULL",
            client_id: "TEXT NOT NULL",
            user_id: "TEXT NOT NULL",
            data: "TEXT",
        }),
        administrateurs: f.createModel<Administrateur>("administrateurs", {
            id: "TEXT PRIMARY KEY NOT NULL",
            nom: "TEXT NOT NULL",
            prenom: "TEXT NOT NULL",
            email: "TEXT NOT NULL",
            telephone: "TEXT",
            role: "TEXT NOT NULL",
            motDePasseHash: "TEXT NOT NULL",
            avatar: "TEXT",
            statut: "TEXT NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            derniereConnexion: "TEXT",
        }),
        clients: f.createModel<Client>("clients", {
            id: "TEXT PRIMARY KEY NOT NULL",
            type: "TEXT NOT NULL",
            nom: "TEXT NOT NULL",
            prenom: "TEXT",
            raisonSociale: "TEXT",
            email: "TEXT NOT NULL",
            telephone: "TEXT NOT NULL",
            telephone2: "TEXT",
            adresse: "TEXT NOT NULL",
            statut: "TEXT NOT NULL",
            notes: "TEXT",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            createdBy: "TEXT NOT NULL",
        }),
        collections: f.createModel<Collection>("collections", {
            id: "TEXT PRIMARY KEY NOT NULL",
            nom: "TEXT NOT NULL",
            description: "TEXT",
            ordre: "INTEGER",
            statut: "TEXT NOT NULL",
            quantite: "INTEGER NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
        }),
        sous_collections: f.createModel<SousCollection>("sous_collections", {
            id: "TEXT PRIMARY KEY NOT NULL",
            collectionId: "TEXT NOT NULL",
            nom: "TEXT NOT NULL",
            description: "TEXT",
            image: "TEXT",
            ordre: "INTEGER",
            statut: "TEXT NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
        }),
        articles: f.createModel<Article>("articles", {
            id: "TEXT PRIMARY KEY NOT NULL",
            collectionId: "TEXT NOT NULL",
            sousCollectionId: "TEXT",
            nom: "TEXT NOT NULL",
            description: "TEXT",
            reference: "TEXT NOT NULL",
            unite: "TEXT NOT NULL",
            prixHT: "REAL NOT NULL",
            tauxTVA: "REAL NOT NULL",
            prixTTC: "REAL NOT NULL",
            dimensions: "TEXT",
            images: "TEXT NOT NULL",
            stockTotal: "INTEGER NOT NULL",
            statut: "TEXT NOT NULL",
            prive: "INTEGER NOT NULL DEFAULT 0",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            createdBy: "TEXT NOT NULL",
        }),
        devis: f.createModel<Devis>("devis", {
            id: "TEXT PRIMARY KEY NOT NULL",
            numero: "TEXT NOT NULL",
            clientId: "TEXT NOT NULL",
            lignes: "TEXT NOT NULL",
            groupes: "TEXT",
            totalHT: "REAL NOT NULL",
            totalTVA: "REAL NOT NULL",
            totalTTC: "REAL NOT NULL",
            afficherTVA: "INTEGER NOT NULL DEFAULT 1",
            afficherTVALignes: "INTEGER NOT NULL DEFAULT 1",
            remiseGlobale: "REAL NOT NULL",
            totalApreRemise: "REAL NOT NULL",
            statut: "TEXT NOT NULL",
            dateEmission: "TEXT NOT NULL",
            dateValidite: "TEXT NOT NULL",
            dateAcceptation: "TEXT",
            notes: "TEXT",
            conditionsPaiement: "TEXT",
            envois: "TEXT",
            factureId: "TEXT",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            createdBy: "TEXT NOT NULL",
        }),
        factures: f.createModel<Facture>("factures", {
            id: "TEXT PRIMARY KEY NOT NULL",
            numero: "TEXT NOT NULL",
            clientId: "TEXT NOT NULL",
            devisId: "TEXT",
            lignes: "TEXT NOT NULL",
            groupes: "TEXT",
            totalHT: "REAL NOT NULL",
            totalTVA: "REAL NOT NULL",
            totalTTC: "REAL NOT NULL",
            afficherTVA: "INTEGER NOT NULL DEFAULT 1",
            afficherTVALignes: "INTEGER NOT NULL DEFAULT 1",
            remiseGlobale: "REAL NOT NULL",
            totalApreRemise: "REAL NOT NULL",
            montantPayé: "REAL NOT NULL",
            montantRestant: "REAL NOT NULL",
            paiements: "TEXT NOT NULL",
            statut: "TEXT NOT NULL",
            dateEmission: "TEXT NOT NULL",
            dateEcheance: "TEXT NOT NULL",
            datePaiementComplet: "TEXT",
            notes: "TEXT",
            conditionsPaiement: "TEXT",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            createdBy: "TEXT NOT NULL",
        }),
        lignes_documents: f.createModel<LigneDocument>("lignes_documents", {
            id: "TEXT PRIMARY KEY NOT NULL",
            documentId: "TEXT NOT NULL",
            documentType: "TEXT NOT NULL",
            articleId: "TEXT NOT NULL",
            varianteId: "TEXT",
            designation: "TEXT NOT NULL",
            reference: "TEXT NOT NULL",
            quantite: "REAL NOT NULL",
            unite: "TEXT NOT NULL",
            prixUnitaireHT: "REAL NOT NULL",
            tauxTVA: "REAL NOT NULL",
            prixUnitaireTTC: "REAL NOT NULL",
            montantTotalHT: "REAL NOT NULL",
            montantTotalTTC: "REAL NOT NULL",
            remise: "REAL NOT NULL",
            notes: "TEXT",
            groupeId: "TEXT",
            sousGroupeId: "TEXT",
        }),
        techniciens: f.createModel<Technicien>("techniciens", {
            id: "TEXT PRIMARY KEY NOT NULL",
            nom: "TEXT NOT NULL",
            prenom: "TEXT NOT NULL",
            telephone: "TEXT NOT NULL",
            email: "TEXT",
            specialite: "TEXT",
            statut: "TEXT NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
        }),
        projets: f.createModel<Projet>("projets", {
            id: "TEXT PRIMARY KEY NOT NULL",
            nom: "TEXT NOT NULL",
            description: "TEXT",
            clientId: "TEXT NOT NULL",
            adresse: "TEXT",
            statut: "TEXT NOT NULL",
            dateDebut: "TEXT NOT NULL",
            dateFin: "TEXT",
            dateFinReelle: "TEXT",
            devisIds: "TEXT NOT NULL",
            technicienIds: "TEXT NOT NULL",
            notes: "TEXT",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            createdBy: "TEXT NOT NULL",
        }),
        boutiques: f.createModel<Boutique>("boutiques", {
            id: "TEXT PRIMARY KEY NOT NULL",
            nom: "TEXT NOT NULL",
            adresse: "TEXT",
            userId: "TEXT",
            isPrincipal: "INTEGER NOT NULL",
            statut: "TEXT NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
        }),
        stocks_boutique: f.createModel<StockBoutique>("stocks_boutique", {
            id: "TEXT PRIMARY KEY NOT NULL",
            boutiqueId: "TEXT NOT NULL",
            articleId: "TEXT NOT NULL",
            varianteId: "TEXT",
            quantite: "INTEGER NOT NULL",
            updatedAt: "TEXT NOT NULL",
        }),
        transferts_stock: f.createModel<TransfertStock>("transferts_stock", {
            id: "TEXT PRIMARY KEY NOT NULL",
            articleId: "TEXT NOT NULL",
            varianteId: "TEXT",
            boutiqueSourceId: "TEXT",
            boutiqueDestId: "TEXT",
            quantite: "INTEGER NOT NULL",
            sens: "TEXT NOT NULL",
            userId: "TEXT NOT NULL",
            note: "TEXT",
            createdAt: "TEXT NOT NULL",
        }),
        entreprises: f.createModel<Entreprise>("entreprises", {
            id: "TEXT PRIMARY KEY NOT NULL",
            matricule: "TEXT NOT NULL",
            nom: "TEXT NOT NULL",
            adresse: "TEXT NOT NULL",
            telephone: "TEXT NOT NULL",
            email: "TEXT NOT NULL",
            logoDataUrl: "TEXT NOT NULL",
            notesDevis: "TEXT NOT NULL",
            notesFacture: "TEXT NOT NULL",
            conditionsPaiement: "TEXT NOT NULL",
            setupDone: "INTEGER NOT NULL",
            customFields: "TEXT NOT NULL",
            devisPrefix: "TEXT NOT NULL",
            facturePrefix: "TEXT NOT NULL",
            numeroFormat: "TEXT NOT NULL",
            tvaDefault: "REAL NOT NULL",
            devise: "TEXT NOT NULL",
            afficherTVA: "INTEGER NOT NULL",
        }),
        taches_projet: f.createModel<TacheProjet>("taches_projet", {
            id: "TEXT PRIMARY KEY NOT NULL",
            projetId: "TEXT NOT NULL",
            titre: "TEXT NOT NULL",
            description: "TEXT",
            statut: "TEXT NOT NULL",
            priorite: "TEXT NOT NULL",
            technicienIds: "TEXT NOT NULL",
            dateDebut: "TEXT",
            dateEcheance: "TEXT",
            ordre: "INTEGER NOT NULL",
            createdAt: "TEXT NOT NULL",
            updatedAt: "TEXT NOT NULL",
            createdBy: "TEXT NOT NULL",
        }),
    };
}

export type Models = ReturnType<typeof buildModels>;

// Tables exposées à la synchronisation (clés strictement contrôlées)
export const SYNCABLE_TABLES = [
    "administrateurs",
    "clients",
    "collections",
    "sous_collections",
    "articles",
    "devis",
    "factures",
    "lignes_documents",
    "techniciens",
    "projets",
    "taches_projet",
    "boutiques",
    "stocks_boutique",
    "transferts_stock",
    "entreprises",
] as const;

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

export function isSyncableTable(name: string): name is SyncableTable {
    return (SYNCABLE_TABLES as readonly string[]).includes(name);
}

export async function initDatabase(db: D1Database): Promise<void> {
    const m = buildModels(db);
    await m.SyncJournal.createTable();
    await m.administrateurs.createTable();
    await m.clients.createTable();
    await m.collections.createTable();
    await m.sous_collections.createTable();
    await m.articles.createTable();
    await m.devis.createTable();
    await m.factures.createTable();
    await m.lignes_documents.createTable();
    await m.techniciens.createTable();
    await m.projets.createTable();
    await m.taches_projet.createTable();
    await m.boutiques.createTable();
    await m.stocks_boutique.createTable();
    await m.transferts_stock.createTable();
    await m.entreprises.createTable();
    await ensureSyncStateTable(m.orm);
    await seedSyncStateIfEmpty(m.orm);
    await runMigrations(m.orm);
}

// ─── sync_state : index de version partagé serveur↔clients ───────────
// Une ligne par (table_name, element_id). `version` est bumpé à chaque
// mutation serveur ; les clients pullent par `version > since`.
async function ensureSyncStateTable(orm: SimpleORM): Promise<void> {
    await orm.run(
        `CREATE TABLE IF NOT EXISTS sync_state (
            table_name TEXT NOT NULL,
            element_id TEXT NOT NULL,
            version    INTEGER NOT NULL DEFAULT 1,
            updatedAt  TEXT NOT NULL,
            updatedBy  TEXT NOT NULL,
            deleted    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (table_name, element_id)
        )`,
    );
    await orm.run(
        `CREATE INDEX IF NOT EXISTS idx_sync_state_version ON sync_state(version)`,
    );
    await orm.run(
        `CREATE INDEX IF NOT EXISTS idx_sync_state_table ON sync_state(table_name)`,
    );
}

// ─── Migrations ──────────────────────────────────────────────────────
const MIGRATIONS: Array<{ name: string; sql: string }> = [
    {
        name: "v1_afficherTVA",
        sql: `ALTER TABLE devis ADD COLUMN afficherTVA INTEGER NOT NULL DEFAULT 1`,
    },
    {
        name: "v1_afficherTVALignes",
        sql: `ALTER TABLE devis ADD COLUMN afficherTVALignes INTEGER NOT NULL DEFAULT 1`,
    },
    {
        name: "v1_afficherTVA_factures",
        sql: `ALTER TABLE factures ADD COLUMN afficherTVA INTEGER NOT NULL DEFAULT 1`,
    },
    {
        name: "v1_afficherTVALignes_factures",
        sql: `ALTER TABLE factures ADD COLUMN afficherTVALignes INTEGER NOT NULL DEFAULT 1`,
    },
    {
        name: "v1_prive_articles",
        sql: `ALTER TABLE articles ADD COLUMN prive INTEGER NOT NULL DEFAULT 0`,
    },
];

async function runMigrations(orm: SimpleORM): Promise<void> {
    await orm.run(
        `CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
    );
    for (const m of MIGRATIONS) {
        const existing = await orm.query<{ n: number }>(
            `SELECT COUNT(*) as n FROM _migrations WHERE name = ?`,
            [m.name],
        );
        if (existing[0]?.n && existing[0].n > 0) continue;
        try {
            await orm.run(m.sql, []);
            await orm.run(`INSERT INTO _migrations (name) VALUES (?)`, [m.name]);
            console.log(`[migration] ${m.name} appliquée`);
        } catch (e) {
            console.warn(`[migration] ${m.name} ignorée (colonne existe déjà ?)`, e);
        }
    }
}

// lignes_documents n'a pas de colonne updatedAt/createdAt → on retombe
// sur datetime('now') pour le seed initial.
const TABLES_WITHOUT_TIMESTAMPS = new Set<string>(["lignes_documents"]);
// `stocks_boutique` n'a que `updatedAt`, `transferts_stock` n'a que `createdAt` —
// le COALESCE(updatedAt, createdAt, datetime('now')) couvre les deux cas.

// Seed rétroactif : si sync_state est vide mais qu'il existe déjà des
// données métier (cas d'un D1 préexistant), on insère un row par entité
// avec version=1, updatedBy='bootstrap'. Idempotent via WHERE NOT EXISTS.
async function seedSyncStateIfEmpty(orm: SimpleORM): Promise<void> {
    const existing = await orm
        .query<{ n: number }>(`SELECT COUNT(*) as n FROM sync_state`, [])
        .catch(() => [{ n: 0 } as { n: number }]);
    if ((existing[0]?.n ?? 0) > 0) return;

    const seeded: Record<string, number> = {};
    for (const table of SYNCABLE_TABLES) {
        const updatedAtExpr = TABLES_WITHOUT_TIMESTAMPS.has(table)
            ? `datetime('now')`
            : `COALESCE(updatedAt, createdAt, datetime('now'))`;
        try {
            await orm.run(
                `INSERT INTO sync_state (table_name, element_id, version, updatedAt, updatedBy, deleted)
                 SELECT '${table}', id, 1, ${updatedAtExpr}, 'bootstrap', 0
                 FROM ${table}
                 WHERE NOT EXISTS (
                     SELECT 1 FROM sync_state s
                     WHERE s.table_name = '${table}' AND s.element_id = ${table}.id
                 )`,
                [],
            );
            const counted = await orm.query<{ n: number }>(
                `SELECT COUNT(*) as n FROM sync_state WHERE table_name = ?`,
                [table],
            );
            seeded[table] = Number(counted[0]?.n ?? 0);
        } catch (e) {
            console.error(`[sync_state] seed ${table} échec`, e);
        }
    }
    console.log(`[sync_state] bootstrap rétroactif`, seeded);
}
