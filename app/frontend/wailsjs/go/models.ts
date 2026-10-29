export namespace buildinfo {
	
	export class Author {
	    name: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new Author(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	    }
	}
	export class Info {
	    name: string;
	    displayName: string;
	    version: string;
	    description: string;
	    repository: string;
	    pkgIdentifier: string;
	    copyright: string;
	    author: Author;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.displayName = source["displayName"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.repository = source["repository"];
	        this.pkgIdentifier = source["pkgIdentifier"];
	        this.copyright = source["copyright"];
	        this.author = this.convertValues(source["author"], Author);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class CaptureResult {
	    created: boolean;
	    meta?: store.Meta;
	
	    static createFrom(source: any = {}) {
	        return new CaptureResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.created = source["created"];
	        this.meta = this.convertValues(source["meta"], store.Meta);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CurrentView {
	    label: string;
	    provider: string;
	    shortId: string;
	    email?: string;
	    saved: boolean;
	    savedId?: string;
	
	    static createFrom(source: any = {}) {
	        return new CurrentView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.provider = source["provider"];
	        this.shortId = source["shortId"];
	        this.email = source["email"];
	        this.saved = source["saved"];
	        this.savedId = source["savedId"];
	    }
	}
	export class HealthView {
	    id: string;
	    status: string;
	    checkedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new HealthView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.status = source["status"];
	        this.checkedAt = source["checkedAt"];
	    }
	}
	export class OAuthResult {
	    created: boolean;
	    billingReady: boolean;
	    meta?: store.Meta;
	
	    static createFrom(source: any = {}) {
	        return new OAuthResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.created = source["created"];
	        this.billingReady = source["billingReady"];
	        this.meta = this.convertValues(source["meta"], store.Meta);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReAuthOutcome {
	    meta?: store.Meta;
	    liveRefreshed: boolean;
	    zcodeRestarted: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ReAuthOutcome(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.meta = this.convertValues(source["meta"], store.Meta);
	        this.liveRefreshed = source["liveRefreshed"];
	        this.zcodeRestarted = source["zcodeRestarted"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StateView {
	    running: boolean;
	    current?: CurrentView;
	    accounts: store.Meta[];
	    hasLastBackup: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StateView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.current = this.convertValues(source["current"], CurrentView);
	        this.accounts = this.convertValues(source["accounts"], store.Meta);
	        this.hasLastBackup = source["hasLastBackup"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UseResult {
	    label: string;
	    writeBackId?: string;
	    writeBackErr?: string;
	    restarted: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UseResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.writeBackId = source["writeBackId"];
	        this.writeBackErr = source["writeBackErr"];
	        this.restarted = source["restarted"];
	    }
	}

}

export namespace quota {
	
	export class CodingPlanLimit {
	    name: string;
	    limit: number;
	    used: number;
	    remaining: number;
	    percent: number;
	    nextReset?: number;
	
	    static createFrom(source: any = {}) {
	        return new CodingPlanLimit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.limit = source["limit"];
	        this.used = source["used"];
	        this.remaining = source["remaining"];
	        this.percent = source["percent"];
	        this.nextReset = source["nextReset"];
	    }
	}
	export class CodingPlanUsage {
	    provider: string;
	    level: string;
	    productName?: string;
	    validPeriod?: string;
	    limits: CodingPlanLimit[];
	
	    static createFrom(source: any = {}) {
	        return new CodingPlanUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.level = source["level"];
	        this.productName = source["productName"];
	        this.validPeriod = source["validPeriod"];
	        this.limits = this.convertValues(source["limits"], CodingPlanLimit);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Item {
	    name: string;
	    total?: number;
	    used?: number;
	    remaining?: number;
	    percentUsed?: number;
	    unit: string;
	    periodEnd?: any;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.total = source["total"];
	        this.used = source["used"];
	        this.remaining = source["remaining"];
	        this.percentUsed = source["percentUsed"];
	        this.unit = source["unit"];
	        this.periodEnd = source["periodEnd"];
	    }
	}
	export class MonthlyStat {
	    month: string;
	    credits: number;
	    dailyAvg: number;
	    days: number;
	    limitCredits: number;
	    percent: number;
	    projectedPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new MonthlyStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.credits = source["credits"];
	        this.dailyAvg = source["dailyAvg"];
	        this.days = source["days"];
	        this.limitCredits = source["limitCredits"];
	        this.percent = source["percent"];
	        this.projectedPercent = source["projectedPercent"];
	    }
	}
	export class WeeklyHistoryStat {
	    cycles: number;
	    dailyPercent: number;
	    weeklyPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new WeeklyHistoryStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cycles = source["cycles"];
	        this.dailyPercent = source["dailyPercent"];
	        this.weeklyPercent = source["weeklyPercent"];
	    }
	}
	export class WeeklyCurrentStat {
	    start: number;
	    end: number;
	    daysElapsed: number;
	    percent: number;
	    dailyPercent: number;
	    projectedPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new WeeklyCurrentStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.daysElapsed = source["daysElapsed"];
	        this.percent = source["percent"];
	        this.dailyPercent = source["dailyPercent"];
	        this.projectedPercent = source["projectedPercent"];
	    }
	}
	export class WeeklyStats {
	    current?: WeeklyCurrentStat;
	    historical?: WeeklyHistoryStat;
	    monthly?: MonthlyStat;
	
	    static createFrom(source: any = {}) {
	        return new WeeklyStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = this.convertValues(source["current"], WeeklyCurrentStat);
	        this.historical = this.convertValues(source["historical"], WeeklyHistoryStat);
	        this.monthly = this.convertValues(source["monthly"], MonthlyStat);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResetCardGroup {
	    count: number;
	    earliestExpiry?: number;
	    lastUsedAt?: number;
	
	    static createFrom(source: any = {}) {
	        return new ResetCardGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.count = source["count"];
	        this.earliestExpiry = source["earliestExpiry"];
	        this.lastUsedAt = source["lastUsedAt"];
	    }
	}
	export class ResetCards {
	    fiveHour: ResetCardGroup;
	    week: ResetCardGroup;
	
	    static createFrom(source: any = {}) {
	        return new ResetCards(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fiveHour = this.convertValues(source["fiveHour"], ResetCardGroup);
	        this.week = this.convertValues(source["week"], ResetCardGroup);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlanTier {
	    label: string;
	    tier: string;
	
	    static createFrom(source: any = {}) {
	        return new PlanTier(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.tier = source["tier"];
	    }
	}
	export class Overview {
	    total?: number;
	    used?: number;
	    remaining?: number;
	    percentUsed?: number;
	    isEmpty: boolean;
	    planTier?: PlanTier;
	    items: Item[];
	    codingPlan?: CodingPlanUsage;
	    resetCards?: ResetCards;
	    weekly?: WeeklyStats;
	    refreshedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new Overview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.used = source["used"];
	        this.remaining = source["remaining"];
	        this.percentUsed = source["percentUsed"];
	        this.isEmpty = source["isEmpty"];
	        this.planTier = this.convertValues(source["planTier"], PlanTier);
	        this.items = this.convertValues(source["items"], Item);
	        this.codingPlan = this.convertValues(source["codingPlan"], CodingPlanUsage);
	        this.resetCards = this.convertValues(source["resetCards"], ResetCards);
	        this.weekly = this.convertValues(source["weekly"], WeeklyStats);
	        this.refreshedAt = source["refreshedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class WeeklyCycle {
	    start: number;
	    end: number;
	    finalPct: number;
	    usedCredits: number;
	    limitCredits: number;
	    sampleDays: number;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WeeklyCycle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.finalPct = source["finalPct"];
	        this.usedCredits = source["usedCredits"];
	        this.limitCredits = source["limitCredits"];
	        this.sampleDays = source["sampleDays"];
	        this.active = source["active"];
	    }
	}
	
	export class WeeklyReport {
	    cycles: WeeklyCycle[];
	    streakDays: number;
	    longestStreakDays: number;
	    syncedAt?: number;
	
	    static createFrom(source: any = {}) {
	        return new WeeklyReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cycles = this.convertValues(source["cycles"], WeeklyCycle);
	        this.streakDays = source["streakDays"];
	        this.longestStreakDays = source["longestStreakDays"];
	        this.syncedAt = source["syncedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class Meta {
	    id: string;
	    shortId: string;
	    emailShortId: string;
	    userId: string;
	    provider: string;
	    label: string;
	    email?: string;
	    phone?: string;
	    name?: string;
	    avatar?: string;
	    note?: string;
	    source?: string;
	    capturedAt: number;
	    updatedAt?: number;
	
	    static createFrom(source: any = {}) {
	        return new Meta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.shortId = source["shortId"];
	        this.emailShortId = source["emailShortId"];
	        this.userId = source["userId"];
	        this.provider = source["provider"];
	        this.label = source["label"];
	        this.email = source["email"];
	        this.phone = source["phone"];
	        this.name = source["name"];
	        this.avatar = source["avatar"];
	        this.note = source["note"];
	        this.source = source["source"];
	        this.capturedAt = source["capturedAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}

}

export namespace update {
	
	export class Result {
	    current: string;
	    latest: string;
	    hasUpdate: boolean;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.hasUpdate = source["hasUpdate"];
	        this.url = source["url"];
	    }
	}

}

