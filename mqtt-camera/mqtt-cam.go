// Basic MQTT Camera source - for home assistant.
// Needs Paho MQTT client and opencv for GO (gocv) installed
// Author: Joakim Eriksson, joakim.eriksson@ri.se

package main

import (
	"fmt"
	"time"

	MQTT "github.com/eclipse/paho.mqtt.golang"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	proto "github.com/golang/protobuf/proto"
	"gocv.io/x/gocv"

	pb "./images.pb"
)

type MqttCam struct {
	Host   string
	Topic  string
	Camera string
	Opts   *MQTT.ClientOptions
	Avg    gocv.Mat
}

func (mq *MqttCam) show() {
	fmt.Println(mq.Host, " with topic:", mq.Topic)
}

//define a function for the default message handler
var f MQTT.MessageHandler = func(client MQTT.Client, msg MQTT.Message) {
	fmt.Printf("TOPIC: %s\n", msg.Topic())
	fmt.Printf("MSG: %s\n", msg.Payload())
}

func main() {
	mcam := MqttCam{
		Host:   "localhost:1883",
		Topic:  "ha/camera/mqtt",
		Camera: "0",
	}

	//create a ClientOptions struct setting the broker address, clientid, turn
	//off trace output and set the default message handler
	mcam.Opts = MQTT.NewClientOptions().AddBroker(mcam.Host)
	mcam.Opts.SetClientID("go-simple")
	mcam.Opts.SetDefaultPublishHandler(f)

	mcam.show()

	c := mqtt.NewClient(mcam.Opts)
	c.Connect()

	//window := gocv.NewWindow("Hello")
	//w2 := gocv.NewWindow("Hello - Avg.")

	webcam, _ := gocv.OpenVideoCapture(mcam.Camera)

	mcam.Avg = gocv.NewMat()
	img := gocv.NewMat()
	sub := gocv.NewMat()
	gray := gocv.NewMat()
	th1 := gocv.NewMat()

	time.Sleep(3 * time.Second)

	webcam.Read(&mcam.Avg)

	// The camera loop
	for {
		webcam.Read(&img)
		gocv.Subtract(img, mcam.Avg, &sub)
		gocv.CvtColor(sub, &gray, gocv.ColorBGRToGray)
		gocv.Threshold(gray, &th1, 35, 255, gocv.ThresholdBinary)
		gocv.AddWeighted(img, 0.1, mcam.Avg, 0.9, 0.0, &mcam.Avg)

		th1.DivideFloat(255.0)
		h := float64(th1.Size()[0])
		w := float64(th1.Size()[1])
		diff := th1.Sum().Val1 / (w * h)
		if diff > 0.01 {
			fmt.Println("Sum", diff)
			imgdata, _ := gocv.IMEncode(".png", img)
			//fmt.Println("IMG:", imgdata, error)
			fmt.Println("Publish image on ", mcam.Topic)
			c.Publish(mcam.Topic, 0, false, string(imgdata))

			test := &pb.Image{
				Width:   int32(w),
				Height:  int32(h),
				Id:      "hej",
				Imgdata: imgdata,
			}
			data, err := proto.Marshal(test)
			fmt.Println("Publish pb image.", err)
			c.Publish(mcam.Topic+"_pb", 0, false, data)
		}
		//window.IMShow(img)
		//w2.IMShow(mcam.Avg)
		//window.WaitKey(1)
	}
	c.Disconnect(250)
}
