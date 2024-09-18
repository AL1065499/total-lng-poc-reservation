exports.setTimeoutPromise = timeout => new Promise(resolve => {
    setTimeout(resolve, timeout);
});