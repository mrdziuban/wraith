// modules
var system = require('system'),
    casper = require('casper').create(),
    helper = requireRelative('_helper.js')(casper.cli.get(1));

// command line arguments
var url = casper.cli.get(0),
    dimensions = helper.dimensions,
    image_name = casper.cli.get(2),
    selector = casper.cli.get(3),
    beforeStartJS = casper.cli.get(4),
    globalBeforeCaptureJS = casper.cli.get(5),
    pathBeforeCaptureJS = casper.cli.get(6),
    customResourcesToIgnore = casper.cli.get(7).split(',')
                                .map(function(s) { return s.trim(); })
                                .filter(function(s) { return s !== ''; }),
    dimensionsProcessed = 0,
    currentDimensions;

var ResourceStatus = {
  PENDING: 'pending',
  DONE: 'done',
  TIMEOUT: 'timeout',
  ERROR: 'error'
};
var resourceStatusMap = {};
var resourcesToIgnore = ['www.google-analytics.com'].concat(customResourcesToIgnore);

casper.on('resource.requested', function(requestData, request) {
  var url = requestData.url;
  for (var i = 0; i < resourcesToIgnore.length; i++) {
    var bad = resourcesToIgnore[i];
    if (bad === url || url.match(new RegExp(bad))) {
      request.abort();
      return;
    }
  }

  resourceStatusMap[url] = ResourceStatus.PENDING;
});

// `this` will be the status to update to
function updateRequestStatus(request) {
  if (resourceStatusMap[request.url] === ResourceStatus.PENDING) {
    resourceStatusMap[request.url] = this;
  }
}

casper.on('resource.received', updateRequestStatus.bind(ResourceStatus.DONE));
casper.on('resource.timeout', updateRequestStatus.bind(ResourceStatus.TIMEOUT));
casper.on('resource.error', updateRequestStatus.bind(ResourceStatus.ERROR));

// functions
function requireRelative(file) {
  // PhantomJS will automatically `require` relatively, but CasperJS needs some extra help. Hence this function.
  // 'templates/javascript/casper.js' -> 'templates/javascript'
  var currentFilePath = system.args[3].split('/');
  currentFilePath.pop();
  var fs = require('fs');
  currentFilePath = fs.absolute(currentFilePath.join('/'));
  return require(currentFilePath + '/' + file);
}

function waitForLoad(callback) {
  var pending = false;
  for (var url in resourceStatusMap) {
    if (resourceStatusMap[url] === ResourceStatus.PENDING) {
      pending = true;
    }
  }

  if (pending) {
    casper.wait(500, function() { waitForLoad(callback); });
  } else {
    callback();
  }
}

function snap() {
  console.log('Snapping ' + url + ' at: ' + currentDimensions.viewportWidth + 'x' + currentDimensions.viewportHeight);

  if (!selector) {
    this.capture(image_name);
  }
  else {
    this.captureSelector(image_name, selector);
  }

  dimensionsProcessed++;
  if (helper.takingMultipleScreenshots(dimensions) && dimensionsProcessed < dimensions.length) {
    currentDimensions = dimensions[dimensionsProcessed];
    image_name = helper.replaceImageNameWithDimensions(image_name, currentDimensions);
    casper.viewport(currentDimensions.viewportWidth, currentDimensions.viewportHeight);
    casper.wait(300, function then () {
      snap.bind(this)();
    });
  }
}

if (helper.takingMultipleScreenshots(dimensions)) {
  currentDimensions = dimensions[0];
  image_name = helper.replaceImageNameWithDimensions(image_name, currentDimensions);
}
else {
  currentDimensions = dimensions;
}

function beforeCapture() {
  var self = this;
  if (globalBeforeCaptureJS && pathBeforeCaptureJS) {
    require(globalBeforeCaptureJS)(self, function() {
      self.wait(500, function() {
        waitForLoad(function() {
          require(pathBeforeCaptureJS)(self, function() {
            self.wait(500, function() {
              waitForLoad(captureImage);
            });
          });
        });
      });
    });
  } else if (globalBeforeCaptureJS) {
    require(globalBeforeCaptureJS)(self, function() {
      self.wait(500, function() { waitForLoad(captureImage); });
    });
  } else if (pathBeforeCaptureJS) {
    require(pathBeforeCaptureJS)(self, function() {
      self.wait(500, function() { waitForLoad(captureImage); });
    });
  } else {
    captureImage();
  }
}

function start() {
  // Casper can now do its magic
  casper.start();
  casper.open(url);
  casper.viewport(currentDimensions.viewportWidth, currentDimensions.viewportHeight);
  casper.then(function() {
    waitForLoad(beforeCapture.bind(this));
  });
  casper.run();
}

function captureImage() {
  // waits for all images to download before taking screenshots
  // (broken images are a big cause of Wraith failures!)
  // Credit: http://reff.it/8m3HYP
  casper.waitFor(function() {
    return this.evaluate(function() {
      var images = document.getElementsByTagName('img');
      return Array.prototype.every.call(images, function(i) { return i.complete; });
    });
  }, function then () {
    snap.bind(this)();
  });
}

beforeStartJS ? require(beforeStartJS)(casper, start) : start();
