angular.module('FredrikSandell.worker-pool', []).service('WorkerService', [
    '$q',
    function ($q) {
        var that = {};
        //this should be configured from the app in the future
        var urlToAngular = 'http://localhost:9876/base/bower_components/angular/angular.js';
        var importScriptsUrls = [];
        var importScripts = '';
        var serviceToUrlMap = {};

        function updateImportList (){
            importScripts = '';
            importScriptsUrls.forEach(function(item, indx){
                if(indx !== 0){
                    importScripts += ',';
                }
                importScripts += '\''+item+'\'';
            });
        }

        that.setAngularUrl = function (urlToAngularJs) {
            importScriptsUrls.push(urlToAngularJs);
            updateImportList();
        };
        that.addImportScript = function(importScript){
            importScriptsUrls.push(importScript);
            updateImportList();
        };
        function createAngularWorkerTemplate() {
            /*jshint laxcomma:true */
            /*jshint quotmark: false */
            var workerTemplate = [
                '',
                '//try {',
                'var window = self;',
                'self.history = {};',
                'var document = {',
                '      readyState: \'complete\',',
                '      cookie: \'\',',
                '      querySelector: function () {},',
                '      createElement: function () {',
                '          return {',
                '              pathname: \'\',',
                '              setAttribute: function () {}',
                '          };',
                '      }',
                '};',
                'importScripts(<IMPORT_SCRIPTS>);',
                '<CUSTOM_DEP_INCLUDES>',
                'angular = window.angular;',
                'var workerApp = angular.module(\'WorkerApp\', [<DEP_MODULES>]);',
                'workerApp.run([\'$q\'<STRING_DEP_NAMES>, function ($q<DEP_NAMES>) {',
                '  self.addEventListener(\'message\', function(e) {',
                '    var input = e.data;',
                '    var output = $q.defer();',
                '    var promise = output.promise;',
                '    promise.then(function(success) {',
                '      self.postMessage({event:\'success\', data : success});',
                '    }, function(reason) {',
                '      self.postMessage({event:\'failure\', data : reason});',
                '    }, function(update) {',
                '      self.postMessage({event:\'update\', data : update});',
                '    });',
                '    <WORKER_FUNCTION>;',
                '  });',
                '  self.postMessage({event:\'initDone\'});',
                '}]);',
                'angular.bootstrap(null, [\'WorkerApp\']);',
                '//} catch(e) {self.postMessage(JSON.stringify(e));}'
            ];
            return workerTemplate.join('\n');
        }
        var workerTemplate = createAngularWorkerTemplate();
        that.addDependency = function (serviceName, moduleName, url) {
            serviceToUrlMap[serviceName] = {
                url: url,
                moduleName: moduleName
            };
            return that;
        };
        function createIncludeStatements(listOfServiceNames) {
            var includeString = '';
            angular.forEach(listOfServiceNames, function (serviceName) {
                if (serviceToUrlMap[serviceName]) {
                    includeString += 'importScripts(\'' + serviceToUrlMap[serviceName].url + '\');';
                }
            });
            return includeString;
        }
        function createModuleList(listOfServiceNames) {
            var moduleNameList = [];
            angular.forEach(listOfServiceNames, function (serviceName) {
                if (serviceToUrlMap[serviceName]) {
                    moduleNameList.push('\'' + serviceToUrlMap[serviceName].moduleName + '\'');
                }
            });
            return moduleNameList.join(',');
        }
        function createDependencyMetaData(dependencyList) {
            var dependencyServiceNames = dependencyList.filter(function (dep) {
                return dep !== 'input' && dep !== 'output' && dep !== '$q';
            });
            var depMetaData = {
                dependencies: dependencyServiceNames,
                moduleList: createModuleList(dependencyServiceNames),
                angularDepsAsStrings: dependencyServiceNames.length > 0 ? ',' + dependencyServiceNames.map(function (dep) {
                    return '\'' + dep + '\'';
                }).join(',') : '',
                angularDepsAsParamList: dependencyServiceNames.length > 0 ? ',' + dependencyServiceNames.join(',') : '',
                servicesIncludeStatements: createIncludeStatements(dependencyServiceNames)
            };
            depMetaData.workerFuncParamList = 'input,output' + depMetaData.angularDepsAsParamList;
            return depMetaData;
        }
        function populateWorkerTemplate(workerFunc, dependencyMetaData) {
            return workerTemplate.replace('<IMPORT_SCRIPTS>', importScripts).replace('<CUSTOM_DEP_INCLUDES>', dependencyMetaData.servicesIncludeStatements).replace('<DEP_MODULES>', dependencyMetaData.moduleList).replace('<STRING_DEP_NAMES>', dependencyMetaData.angularDepsAsStrings).replace('<DEP_NAMES>', dependencyMetaData.angularDepsAsParamList).replace('<WORKER_FUNCTION>', workerFunc.toString());
        }
        var buildAngularWorker = function (initializedWorker) {
            var that = {};
            that.worker = initializedWorker;
            that.run = function (input) {
                var deferred = $q.defer();
                initializedWorker.addEventListener('message', function (e) {
                    var eventId = e.data.event;
                    //console.log(e.data);
                    if (eventId === 'initDone') {
                        throw 'Received worker initialization in run method. This should already have occurred!';
                    } else if (eventId === 'success') {
                        deferred.resolve(e.data.data);
                    } else if (eventId === 'failure') {
                        deferred.reject(e.data.data);
                    } else if (eventId === 'update') {
                        deferred.notify(e.data.data);
                    } else {
                        deferred.reject(e);
                    }
                });
                initializedWorker.postMessage(input);
                return deferred.promise;
            };
            that.terminate = function () {
                initializedWorker.terminate();
            };
            return that;
        };
        var extractDependencyList = function (depFuncList) {
            return depFuncList.slice(0, depFuncList.length - 1);
        };
        var workerFunctionToString = function (func, paramList) {
            return '(' + func.toString() + ')(' + paramList + ')';
        };
        /**
         * example call:
         * WorkerService.createAngularWorker(['input', 'output', '$http', function(input, output, $http)
         * {body of function}]);
         * Parameters "input" and "output" is required. Not defining them will cause a runtime error.
         * Declaring services to be injected, as '$http' is above, requires the web worker to be able to resolve them.
         * '$http' service is a part of the standard angular package which means it will resolve without additional information
         * since angular source is always loaded in the web worker.
         * But if a custom service was to be injected the WorkerService would need be be informed on how to resolve the.
         * @param depFuncList
         */
        that.createAngularWorker = function (depFuncList) {
            //validate the input
            if (!Array.isArray(depFuncList) || depFuncList.length < 3 || typeof depFuncList[depFuncList.length - 1] !== 'function') {
                throw 'Input needs to be: [\'workerInput\',\'deferredOutput\'/*optional additional dependencies*/,\n' + '    function(workerInput, deferredOutput /*optional additional dependencies*/)\n' + '        {/*worker body*/}' + ']';
            }
            var deferred = $q.defer();
            var dependencyMetaData = createDependencyMetaData(extractDependencyList(depFuncList));
            var blobURL = (window.webkitURL ? webkitURL : URL).createObjectURL(new Blob([populateWorkerTemplate(workerFunctionToString(depFuncList[depFuncList.length - 1], dependencyMetaData.workerFuncParamList), dependencyMetaData)], { type: 'application/javascript' }));
            var worker = new Worker(blobURL);
            //wait for the worker to load resources
            worker.addEventListener('message', function (e) {
                var eventId = e.data.event;
                console.log(e.data);
                if (eventId === 'initDone') {
                    deferred.resolve(buildAngularWorker(worker));
                } else {
                    deferred.reject(e);
                }
            });
            return deferred.promise;
        };
        return that;
    }
]);
