// Access the global application
var app = pc.Application.getApplication();
var context = app.sceneContext;

var label = context.labels.get("Parkeertoren");

if (label !== undefined) {
    const apiUrl = 'https://capacity.cegeka.com/api/v1.0/GetParkingAvailability/poml';

    // We define the function so we can reuse it
    const updateParkingData = async () => {
        try {
            // We use 'fetch' instead of pc.Asset to avoid internal caching issues
            const response = await fetch(apiUrl);
            
            if (!response.ok) throw new Error("Network response was not ok");
            
            const data = await response.json();
            
            // Check if label still exists (in case scene changed while loading)
            if (label.element) {
                const available = data.data && data.data[0] ? data.data[0].availability : "?";
                label.setText("Parkeertoren\nVrije Plaatsen: " + available);
                console.log("Parking data updated:", available);
            }
        } catch (err) {
            console.error("Failed to fetch parking data:", err);
        }
    };

    // 1. Run immediately so we don't wait for the first minute
    updateParkingData();

    // 2. Set interval to run every 60,000 milliseconds (1 minute)
    // We save the ID so we can stop it later
    const intervalId = setInterval(updateParkingData, 60000);

    // 3. IMPORTANT: Cleanup
    // If this entity (the label) is destroyed (e.g. changing scenes), 
    // stop the timer. Otherwise, it will keep running and crash the app.
    label.on('destroy', () => {
        clearInterval(intervalId);
    });
}