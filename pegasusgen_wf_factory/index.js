/* Hypermedia workflow. 
 ** Creates a new wf instance based on a synthetic pegasus wf generator file
 ** Author: Bartosz Balis (2012)
 */
var fs = require('fs'),
    xml2js = require('xml2js');

exports.init = function() {
    var workflow_cache = {}; // cache for parsed json workfow representations (database substitute)
    var instances = []; // table of existing workflow instances 

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    // returns wf template data (in JSON)
    function public_getTemplate(wfname, cb) {
        // first access: workflow file not yet parsed and cached in memory
        if (!(wfname in workflow_cache)) {
            var parser = new xml2js.Parser();
            fs.readFile(wfname + '.xml', function(err, data) {
                if (err) { 
                    cb(new Error("File read error. Doesn't exist?"));
                    return;
                } else {
                    parser.parseString(data, function(err, result) {
                        if (err) {
                            cb(new Error("File parse error."));
                            return;
                        }
                        workflow_cache[wfname] = result;
                    });
                }
            });
        } 
        
        // first access: initialization of workflow instance data
        if (!(wfname in instances)) {
            instances[wfname] = {"current": 0, "max": 3, "data": []};
        }
     
        cb(null, workflow_cache[wfname]);
    }
        
    // creates a new workflow instance
    function public_createInstance(wfname, baseUrl, cb) { 
        var inst;
		if (wfname in instances) {
			inst = instances[wfname];
			inst.current = (inst.current + 1) % inst.max; 
		} else {
			instances[wfname] = {"current": 0, "max": 3, "data": []};
			inst = instances[wfname];
		}
		inst.data[inst.current] = clone(workflow_cache[wfname]);
        
		createWfInstance(inst.data[inst.current], wfname, baseUrl, inst.current);
        cb(null, inst.current);
    }
    
    function public_getInstance(wfname, id) {
        if (wfname in instances) {
            if (id in instances[wfname].data) {
                return instances[wfname].data[id];                
            }
        } else {
            return new Error("Error: instance doesn't exist.")
        }
    }
    
    function public_getInstanceList(wfname) {
        if (wfname in instances) {
            return instances[wfname];
        } else {
            return new Error("Error: no instances of workflow " + wfname + " found.")
        }
    }

    return {
        createInstance: public_createInstance,
        getTemplate: public_getTemplate,
        getInstance: public_getInstance,
        getInstanceList: public_getInstanceList
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    function createWfInstance(wf, wfname, baseUrl, inst_id) {
        var baseUri = baseUrl + '/workflow/' + wfname + '/instances/' + inst_id;
        var job_id = 0;
        wf.uri = baseUri;
        wf.status = 'ready'; // initial status of workflow instance -- ready but not yet running
        wf.nTasksLeft = wf.job.length;
        // move info about parents to 'job' elements
        foreach(wf.job, function(job) {
            job['@'].status = 'waiting'; // initial status of all jobs - waiting for input data
            job['@'].job_id = ++job_id;
            job['@'].uri = baseUri + '/task-' + job_id;
            foreach(wf.child, function(child) {
                if (job['@'].id == child['@'].ref) {
                    job['@'].parents = child.parent; // assumes that child element always has some parent(s)
                }
            });
        });

        // create an array of workflow data elements
        var found, idx;
        wf.data = [];
        foreach(wf.job, function(job) {
            foreach(job.uses, function(job_data) {
                job_data['@'].status = 'not_ready';
                if (job_data['@'].link == 'output') {
                    idx = wf.data.push({
                        'id': -1,
                        'name': job_data['@'].file,
                        'size': job_data['@'].size,
                        'from': [],
                        'to': []
                    });
                    wf.data[idx - 1].from.push({
                        'job_name': job['@'].name,
                        'job_id': job['@'].job_id,
                        'job_uri': job['@'].uri
                    }); // task from which this data is received
                }
            });
        });

        foreach(wf.job, function(job) {
            foreach(job.uses, function(job_data) {
                if (job_data['@'].link == 'input') {
                    found = undefined;
                    foreach(wf.data, function(data) {
                        if (data.name == job_data['@'].file /* && data.size == job_data['@'].size */ ) { // assumption that if file name and size are the same, the file (data) is the same (no way of knowing this for sure based on the trace file)
                            found = data; // data element already in the array
                        }
                    });
                    if (!found) {
                        idx = wf.data.push({
                            'id': -1,
                            'name': job_data['@'].file,
                            'size': job_data['@'].size,
                            'from': [],
                            'to': []
                        });
                        found = wf.data[idx - 1];
                    }
                    found.to.push({
                        'job_name': job['@'].name,
                        'job_id': job['@'].job_id,
                        'job_uri': job['@'].uri
                    }); // task to which this data is passed 
                }
            });
        });

        // assign identifiers and URIs to data elements
        var id = 0;
        foreach(wf.data, function(data) {
            data.id = ++id;
            data.uri = baseUri + '/data-' + id;
        });

        // add data element id and uri to each 'uses' element of each job
        foreach(wf.data, function(data) {
            foreach(data.to, function(job_input) {
                foreach(wf.job[job_input.job_id - 1].uses, function(job_data) {
                    if (job_data['@'].link == 'input' && job_data['@'].file == data.name) {
                        job_data['@'].id = data.id;
                        job_data['@'].uri = data.uri;
                    }
                });
            });
            foreach(data.from, function(job_input) {
                foreach(wf.job[job_input.job_id - 1].uses, function(job_data) {
                    if (job_data['@'].link == 'output' && job_data['@'].file == data.name) {
                        job_data['@'].id = data.id;
                        job_data['@'].uri = data.uri;
                    }
                });
            });
        });
    }


    function clone(obj) {
        // Handle the 3 simple types, and null or undefined
        if (null == obj || "object" != typeof obj) return obj;

        // Handle Date
        if (obj instanceof Date) {
            var copy = new Date();
            copy.setTime(obj.getTime());
            return copy;
        }

        // Handle Array
        if (obj instanceof Array) {
            var copy = [];
            for (var i = 0, len = obj.length; i < len; ++i) {
                copy[i] = clone(obj[i]);
            }
            return copy;
        }

        // Handle Object
        if (obj instanceof Object) {
            var copy = {};
            for (var attr in obj) {
                if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
            }
            return copy;
        }

        throw new Error("Unable to copy obj! Its type isn't supported.");
    }

    function getWfJson(wfname, cb) {
        if (wfname in workflow_cache) {
            cb(workflow_cache[wfname]);
        }
        else {
            var parser = new xml2js.Parser();
            fs.readFile(file, function(err, data) {
                if (err) cb(new Error("File read error. Doesn't exist?"));
                parser.parseString(data, function(err, result) {
                if (err) cb(new Error("File parse error."));

            });
        });
            adag.parse(wfname + '.xml', wfname, baseUrl, function(w) {
                workflow_cache[wfname] = w;
                cb(workflow_cache[wfname]);
            });
        }
    }

    function foreach(what, cb) {
        function isArray(what) {
            return Object.prototype.toString.call(what) === '[object Array]';
        }

        if (isArray(what)) {
            for (var i = 0, arr = what; i < what.length; i++) {
                cb(arr[i]);
            }
        }
        else {
            cb(what);
        }
    }


    function parse(file, wfname, baseUrl, cb) {
        var parser = new xml2js.Parser();

        parser.on('end', function(result) {
            // WARNING! Presently the callback is called right away, which means all the
            // remaining code in this function is OBSOLETE. Now it has been moved to 
            // createWfInstance method in app.js
            cb(null, result);
            return;

            ///////////////////////////////////
            // CODE BELOW NO LONGER ECECUTED //
            ///////////////////////////////////

            //var i, j, k, children, parents;
            var wf = result;
            var job_id = 0;

            // add baseUrl to the workflow template representation
            wf.baseUrl = baseUrl;

            // move info about parents to 'job' elements
            foreach(wf.job, function(job) {
                job['@'].status = 'waiting'; // initial status of all jobs - waiting for input data
                job['@'].job_id = ++job_id;
                job['@'].uri = baseUrl + '/workflow/' + wfname + '/task-' + job_id;
                foreach(wf.child, function(child) {
                    if (job['@'].id == child['@'].ref) {
                        job['@'].parents = child.parent; // assumes that child element always has some parent(s)

                        /*console.log(child['@'].ref);
    					  foreach(child.parent, function(parent) {
						  console.log('    ' + parent['@'].ref);
						  });*/
                    }
                });

            });

            // create an array of workflow data elements
            var found, idx;
            wf.data = [];
            foreach(wf.job, function(job) {
                foreach(job.uses, function(job_data) {
                    job_data['@'].status = 'not_ready';
                    if (job_data['@'].link == 'output') {
                        idx = wf.data.push({
                            'id': -1,
                            'name': job_data['@'].file,
                            'size': job_data['@'].size,
                            'from': [],
                            'to': []
                        });
                        wf.data[idx - 1].from.push({
                            'job_name': job['@'].name,
                            'job_id': job['@'].job_id,
                            'job_uri': job['@'].uri
                        }); // task from which this data is received
                    }
                });
            });
            foreach(wf.job, function(job) {
                foreach(job.uses, function(job_data) {
                    if (job_data['@'].link == 'input') {
                        found = undefined;
                        foreach(wf.data, function(data) {
                            if (data.name == job_data['@'].file /* && data.size == job_data['@'].size */ ) { // assumption that if file name and size are the same, the file (data) is the same (no way of knowing this for sure based on the trace file)
                                found = data; // data element already in the array
                            }
                        });
                        if (!found) {
                            idx = wf.data.push({
                                'id': -1,
                                'name': job_data['@'].file,
                                'size': job_data['@'].size,
                                'from': [],
                                'to': []
                            });
                            found = wf.data[idx - 1];
                        }
                        found.to.push({
                            'job_name': job['@'].name,
                            'job_id': job['@'].job_id,
                            'job_uri': job['@'].uri
                        }); // task to which this data is passed 
                    }
                });
            });

            // assign identifiers and URIs to data elements
            var id = 0;
            foreach(wf.data, function(data) {
                data.id = ++id;
                data.uri = baseUrl + '/workflow/' + wfname + '/data-' + id;
            });

            // add data element id and uri to each 'uses' element of each job
            // TODO: remove it from here and leave it only on creating WF instance
            // representation from WF template
            foreach(wf.data, function(data) {
                foreach(data.to, function(job_input) {
                    foreach(wf.job[job_input.job_id - 1].uses, function(job_data) {
                        if (job_data['@'].link == 'input' && job_data['@'].file == data.name) {
                            job_data['@'].id = data.id;
                            job_data['@'].uri = data.uri;
                        }
                    });
                });
                foreach(data.from, function(job_input) {
                    foreach(wf.job[job_input.job_id - 1].uses, function(job_data) {
                        if (job_data['@'].link == 'output' && job_data['@'].file == data.name) {
                            job_data['@'].id = data.id;
                            job_data['@'].uri = data.uri;
                        }
                    });
                });
            });

            cb(null, wf);
        });

        fs.readFile(file, function(err, data) {
            if (err) cb(new Error("File read error. Doesn't exist?"));
            parser.parseString(data, function(err, result) {
                if (err) cb(new Error("File parse error."));

            });
        });

    }

};
