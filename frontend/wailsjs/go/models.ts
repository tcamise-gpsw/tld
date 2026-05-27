export namespace main {
	
	export class DialogFilter {
	    displayName: string;
	    pattern: string;
	
	    static createFrom(source: any = {}) {
	        return new DialogFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.displayName = source["displayName"];
	        this.pattern = source["pattern"];
	    }
	}
	export class FileDialogResult {
	    path: string;
	    content: string;
	    canceled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileDialogResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.content = source["content"];
	        this.canceled = source["canceled"];
	    }
	}
	export class SaveFileResult {
	    path: string;
	    canceled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveFileResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.canceled = source["canceled"];
	    }
	}

}

