'use strict';
// Keep the real worker, but give each test run private IndexedDB names.
const fixtureBase=new URL('../',self.location.href),fixtureSuffix=new URL(self.location.href).searchParams.get('db');
const fixtureImport=self.importScripts.bind(self);
self.importScripts=(...files)=>fixtureImport(...files.map(file=>new URL(file,fixtureBase).href));
importScripts('backtest-batch-worker.js');
let fixtureArchive,fixtureResults;
BacktestResearchStore.getDefault=()=>fixtureArchive??=BacktestResearchStore.open({dbName:'qa-raw'+fixtureSuffix});
BacktestResults.getDefault=()=>fixtureResults??=BacktestResults.open({name:'qa-result'+fixtureSuffix});
