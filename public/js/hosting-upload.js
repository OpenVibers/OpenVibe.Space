/* Space deploy form: shared pickers, with the native folder FileList kept for relative paths. */
(function () {
    'use strict';
    var form = document.querySelector('form.hd-form[enctype="multipart/form-data"]');
    var source = form && form.querySelector('.hd-sources');
    var error = form && form.querySelector('[data-deploy-error]');
    var progressRoot = form && form.querySelector('[data-deploy-progress]');
    if (!form || !source || !error || !progressRoot || !window.OVUpload || !window.DataTransfer) return;
    var limits = { files: Number(source.dataset.maxFiles), file: Number(source.dataset.maxFileBytes), upload: Number(source.dataset.maxUploadBytes) };
    var inputs = { folder: form.querySelector('[data-deploy-folder]'), archive: form.querySelector('[data-deploy-archive]') };
    var roots = { folder: form.querySelector('[data-folder-picker]'), archive: form.querySelector('[data-archive-picker]') };
    var pickers = {};
    var selected = { folder: [], archive: [] };
    var sending = false;
    var meter = OVUpload.progress(progressRoot, { onRetry: send });
    function fail(message) { error.textContent = message; error.hidden = false; }
    function empty(name) {
        selected[name] = [];
        inputs[name].value = '';
        if (pickers[name]) {
            pickers[name].rows.querySelectorAll('.ov-upload__row').forEach(function (row) { row.dispatchEvent(new Event('remove')); });
            pickers[name].rows.replaceChildren();
        }
    }
    function validate(name, files) {
        if (!files.length) return 'Choose a folder or a .tar, .tgz or .tar.gz archive.';
        if (name === 'folder' && files.some(function (file) { return !file.webkitRelativePath || !file.webkitRelativePath.includes('/'); })) return 'Choose a folder with the folder button so file paths are kept.';
        if (name === 'archive' && (files.length !== 1 || !/\.(tar|tgz|tar\.gz)$/i.test(files[0].name))) return 'Choose one .tar, .tgz or .tar.gz archive.';
        if (name === 'folder' && files.length > limits.files) return 'This project allows at most ' + limits.files + ' files in one deploy.';
        if (name === 'folder' && files.some(function (file) { return file.size > limits.file; })) return 'A file is larger than this project’s per-file limit of ' + OVUpload.size(limits.file) + '.';
        if (files.reduce(function (total, file) { return total + file.size; }, 0) > limits.upload) return 'This upload is larger than ' + OVUpload.size(limits.upload) + '.';
        return '';
    }
    function accept(name, fileList) {
        var files = Array.from(fileList || []);
        var problem = validate(name, files);
        if (problem) { fail(problem); return false; }
        var other = name === 'folder' ? 'archive' : 'folder';
        empty(other); empty(name);
        selected[name] = files;
        inputs[name].files = fileList;
        error.hidden = true;
        meter.update({ state: 'waiting', done: 0, total: files.reduce(function (sum, file) { return sum + file.size; }, 0) });
        return true;
    }
    Object.keys(inputs).forEach(function (name) {
        var input = inputs[name];
        var root = roots[name];
        var picker = OVUpload.picker(root, {
            label: name === 'folder' ? 'Choose a folder' : 'Choose an archive',
            accept: name === 'archive' ? input.accept : '', multiple: name === 'folder',
            onRemove: function (file) {
                selected[name] = selected[name].filter(function (item) { return item !== file; });
                var transfer = new DataTransfer();
                selected[name].forEach(function (item) { transfer.items.add(item); });
                input.files = transfer.files;
                if (!selected[name].length) meter.update({ state: 'waiting', done: 0, total: 0 });
            }
        });
        pickers[name] = picker;
        picker.input.setAttribute('aria-describedby', 'deploy-limit');
        if (name === 'folder') picker.input.setAttribute('webkitdirectory', '');
        picker.input.addEventListener('change', function (event) {
            if (!accept(name, picker.input.files)) { event.stopImmediatePropagation(); picker.input.value = ''; }
        }, true);
        root.addEventListener('drop', function (event) {
            if (!event.dataTransfer || !accept(name, event.dataTransfer.files)) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
        }, true);
        input.hidden = true;
    });

    function send() {
        if (sending) return;
        var files = selected.folder.length ? selected.folder : selected.archive;
        var name = selected.folder.length ? 'folder' : 'archive';
        var problem = validate(name, files);
        if (problem) return fail(problem);
        sending = true; error.hidden = true;
        var button = form.querySelector('[type="submit"]');
        button.disabled = true;
        form.querySelectorAll('.ov-upload__remove').forEach(function (remove) { remove.disabled = true; });
        var total = files.reduce(function (sum, file) { return sum + file.size; }, 0);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', form.action);
        xhr.upload.onprogress = function (event) { if (event.lengthComputable) meter.update({ state: 'sending', done: event.loaded, total: event.total }); };
        xhr.upload.onload = function () { meter.update({ state: 'processing', done: total, total: total, message: 'Checking the deploy' }); };
        function retry(message) {
            sending = false; button.disabled = false;
            form.querySelectorAll('.ov-upload__remove').forEach(function (remove) { remove.disabled = false; });
            meter.update({ state: 'failed', message: message });
        }
        xhr.onerror = function () { retry('The connection stopped. Try again.'); };
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 400 && xhr.responseURL && xhr.responseURL !== form.action) {
                meter.update({ state: 'done', done: total, total: total });
                window.location.assign(xhr.responseURL); return;
            }
            var page = new DOMParser().parseFromString(xhr.responseText || '', 'text/html');
            retry(page.querySelector('.hd-flash, .hd-error, h1')?.textContent || 'The deploy could not be uploaded. Try again.');
        };
        meter.update({ state: 'sending', done: 0, total: total });
        xhr.send(new FormData(form));
    }
    form.addEventListener('submit', function (event) { event.preventDefault(); send(); });
})();
