class ApiResponse { constructor(statusCode, message, data, extra={}) { this.success=true; this.message=message; if(data!==undefined)this.data=data; Object.assign(this,extra); this.statusCode=statusCode; } }
module.exports = ApiResponse;
